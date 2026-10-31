"""Record a demo site's live run for replay, or measure its naive baseline.

Talks to the running API over HTTP only (start it first with `make api`; it needs real keys).

    make record SITE=<id>      # live run -> fixtures/traces/<id>.jsonl (+ one JPEG per attempt)
    make baseline SITE=<id>    # one stealth + proxy run -> prints `baseline_steps: N`
    make alone SITE=<id>       # one plain TinyFish agent run -> fixtures/traces/<id>.alone.json

Equivalent: cd apps/api && uv run python ../../scripts/record_trace.py --site <id> [--baseline]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx
import yaml

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "fixtures"
STREAM_TIMEOUT = httpx.Timeout(10.0, read=None)


def load_site(site_id: str) -> dict[str, Any]:
    data = yaml.safe_load((FIXTURES / "sites.yaml").read_text(encoding="utf-8")) or {}
    for site in data.get("sites") or []:
        if site.get("id") == site_id:
            if str(site_id).startswith("TODO"):
                sys.exit(f"site {site_id!r} is still a template entry; fill it in first")
            return site
    sys.exit(f"unknown site {site_id!r}; ids are listed in fixtures/sites.yaml")


def run_body(site: dict[str, Any], baseline: bool, alone: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "url": site["url"],
        "goal": site["goal"],
        "expected": site.get("expected"),
        "output_schema": site.get("output_schema"),
        "site_id": site["id"],
        "mode": "live",
        "start_rung": site.get("start_rung") or "fetch",
        "max_attempts": None,
        "max_credits": None,
    }
    if baseline:
        body.update(start_rung="agent_stealth", max_attempts=1)
    if alone:
        # TinyFish on its own: the default browser, the plain goal, one try, no fixes.
        body.update(start_rung="agent", max_attempts=1)
    return body


def describe(event: dict[str, Any]) -> str:
    kind = event["type"]
    if kind == "trace_event":
        return f"  [{event['attempt_no']}] {event['event']['kind']}: {event['event']['label']}"
    if kind == "attempt_started":
        return f"attempt {event['attempt_no']} on {event['rung']}"
    if kind == "verify":
        return f"  {event['result']['summary']}"
    if kind == "diagnosis":
        d = event["diagnosis"]
        return f"  diagnosis: {d['failure_class']} ({d['source']}, {d['confidence']:.2f})"
    if kind == "verdict":
        return f"VERDICT {event['status']}: {event['reason']} ({event['credits_used']} credits)"
    return f"  {kind}"


def follow(client: httpx.Client, api: str, run_id: str) -> list[str]:
    """Return every UI event payload, verbatim, until the verdict."""
    lines: list[str] = []
    with client.stream("GET", f"{api}/runs/{run_id}/stream", timeout=STREAM_TIMEOUT) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            lines.append(payload)
            event = json.loads(payload)
            print(describe(event))
            if event["type"] == "verdict":
                break
    return lines


def save_screenshots(client: httpx.Client, api: str, run: dict[str, Any], site_id: str) -> int:
    """One JPEG per agent attempt: the failing step if it was diagnosed, else its last step."""
    saved = 0
    folder = FIXTURES / "traces" / site_id
    for attempt in run.get("attempts") or []:
        if attempt.get("rung") == "fetch":
            continue
        n = attempt["attempt_no"]
        kind = "screenshot" if attempt.get("diagnosis") else "latest-screenshot"
        resp = client.get(f"{api}/runs/{run['id']}/attempts/{n}/{kind}")
        if resp.status_code == 200 and resp.content:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"attempt-{n}.jpg").write_bytes(resp.content)
            saved += 1
    return saved


def save_alone(run: dict[str, Any], site_id: str) -> int:
    """What TinyFish alone delivered, as judged by the same verifier, for the comparison card."""
    attempt = (run.get("attempts") or [{}])[0]
    verify = attempt.get("verify") or {}
    diagnosis = attempt.get("diagnosis") or {}
    summary = {
        "site_id": site_id,
        "tinyfish_status": attempt.get("tf_status"),
        "passed": bool(verify.get("passed")),
        "verify_summary": verify.get("summary"),
        "failure_class": diagnosis.get("failure_class"),
        "result": attempt.get("result"),
        "credits": run.get("credits_used", 0),
        "recorded_at": run.get("created_at"),
    }
    out = FIXTURES / "traces" / f"{site_id}.alone.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    verdict = "passed" if summary["passed"] else "failed"
    print(f"\nwrote {out.relative_to(REPO)}: TinyFish alone {verdict}")
    print(f"  {summary['verify_summary']}")
    return 0


def main() -> int:
    # Windows consoles default to cp1252, which can't print every trace label.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--site", required=True, help="site id from fixtures/sites.yaml")
    parser.add_argument("--api", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--baseline", action="store_true", help="measure one stealth+proxy run")
    parser.add_argument("--alone", action="store_true", help="one plain TinyFish run, judged")
    args = parser.parse_args()

    site = load_site(args.site)
    api = args.api.rstrip("/")
    with httpx.Client(timeout=30.0) as client:
        created = client.post(f"{api}/runs", json=run_body(site, args.baseline, args.alone))
        if created.status_code != 201:
            print(f"POST /runs failed ({created.status_code}): {created.text}", file=sys.stderr)
            return 1
        run_id = created.json()["run_id"]
        label = "baseline" if args.baseline else "alone" if args.alone else "record"
        print(f"run {run_id} ({label}) for {args.site}")
        lines = follow(client, api, run_id)
        run = client.get(f"{api}/runs/{run_id}").json()

        if args.baseline:
            steps = (run.get("attempts") or [{}])[0].get("num_of_steps")
            print(
                f"\nbaseline_steps: {steps}    # paste into fixtures/sites.yaml under {args.site}"
            )
            return 0

        if args.alone:
            return save_alone(run, args.site)

        out = FIXTURES / "traces" / f"{args.site}.jsonl"
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
        meta = {k: site.get(k) for k in ("title", "summary", "kind", "expected_class")}
        (FIXTURES / "traces" / f"{args.site}.meta.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        shots = save_screenshots(client, api, run, args.site)
        classes = [a["diagnosis"]["failure_class"] for a in run["attempts"] if a.get("diagnosis")]
        print(f"\nwrote {out.relative_to(REPO)} ({len(lines)} events, {shots} screenshots)")
        print(
            f"classes: {' -> '.join(classes) or 'none'}; verdict: {run['status']}; "
            f"credits: {run['credits_used']} (expected class: {site.get('expected_class')})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
