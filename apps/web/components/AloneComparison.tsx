import type { DemoRun } from "@/lib/demoIndex";
import { STATUS_LABEL } from "@/lib/format";

function Row({
  label,
  ok,
  children,
}: {
  label: string;
  ok: boolean | null;
  children: React.ReactNode;
}) {
  const mark =
    ok === null
      ? "border-ink-600 text-ink-400"
      : ok
        ? "border-moss-500/60 bg-moss-950 text-moss-300"
        : "border-ember-500/60 bg-ember-950 text-ember-300";
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${mark}`}
        aria-hidden
      >
        {ok === null ? "·" : ok ? "✓" : "✕"}
      </span>
      <div className="min-w-0">
        <p className="kicker">{label}</p>
        <p className="mt-0.5 text-sm leading-snug text-ink-200">{children}</p>
      </div>
    </div>
  );
}

function titleCase(label: string): string {
  return label.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/**
 * One plain TinyFish run vs the AskYoda run on the same page, both judged by the same verifier.
 * Renders nothing until the TinyFish-alone run has been recorded. A pass is shown as a pass:
 * the block never claims a failure that didn't happen.
 */
export default function AloneComparison({ run }: { run: DemoRun }) {
  const alone = run.alone;
  if (!alone) return null;
  const said = alone.tinyfish_status === "COMPLETED" ? "Said COMPLETED — " : "";
  const verified = run.status === "verified";
  const ours =
    run.status === null
      ? "Not finished"
      : verified
        ? `Verified · ${run.attempts_used} attempt${run.attempts_used === 1 ? "" : "s"} · ${run.credits_used} cr`
        : titleCase(STATUS_LABEL[run.status]);
  return (
    <div className="divide-y divide-ink-700/70 rounded-xl border border-ink-700 bg-ink-950/60">
      <Row label="TinyFish alone" ok={alone.passed}>
        {alone.passed ? "Also passed" : `${said}${alone.verify_summary ?? "failed the check"}`}
      </Row>
      <Row
        label="With AskYoda"
        ok={verified ? true : run.status === null || run.status === "unrecoverable" ? null : false}
      >
        {ours}
      </Row>
    </div>
  );
}
