import { describe, expect, it } from "vitest";

import { classify } from "../src/rules.js";
import type { ExpectedCheck, FetchExtraction, Rung, TraceEvent } from "../src/types.js";
import { makeExpected } from "../src/types.js";
import { verify } from "../src/verifier.js";
import { attemptOf, ev } from "./fakes.js";

const MIN3 = makeExpected({ type: "min_items", path: "products", min: 3 });

function agentTrace(...purposes: string[]): TraceEvent[] {
  const events = [ev(1, "started"), ev(2, "live_view")];
  purposes.forEach((p, i) => events.push(ev(3 + i, "progress", p, { stepNo: i + 1 })));
  events.push(ev(3 + purposes.length, "complete"));
  return events;
}

function run(
  rung: Rung,
  trace: TraceEvent[],
  opts: { expected?: ExpectedCheck | null; fetch?: Record<string, unknown> | null; extraction?: FetchExtraction | null } = {},
  fields: Parameters<typeof attemptOf>[1] = {},
) {
  const attempt = attemptOf(rung, fields);
  const vr = verify(attempt, { expected: opts.expected ?? null }, trace, opts.fetch ?? null);
  return classify(attempt, vr, trace, [], opts.extraction ?? null, opts.fetch ?? null);
}

const fetchOf = (text: string | null = null, error: Record<string, unknown> | null = null, finalUrl = "https://x.example") => ({
  results: text !== null ? [{ url: "https://x.example", final_url: finalUrl, text }] : [],
  errors: error ? [error] : [],
});

const FETCH_TRACE = [ev(1, "fetch_result"), ev(2, "extraction")];
const FETCH_ERROR_TRACE = [ev(1, "fetch_error")];

describe("classify", () => {
  it("R1 captcha in steps", () => {
    const v = run("agent", agentTrace("Opened the form", "A reCAPTCHA checkbox blocks the submit button"), {}, { tf_status: "COMPLETED", result: null });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["captcha", 0.95, "R1"]);
    expect(v.failing_step_seq).toBe(4);
  });

  it("R1 weak captcha only in fetch text defers to the LLM", () => {
    const v = run("fetch", FETCH_TRACE, { fetch: fetchOf("Please verify you are human. Press & hold.") }, {
      tf_status: "OK",
      result: { status: "failure", reason: "no data" },
    });
    expect([v.failure_class, v.confidence]).toEqual(["captcha", 0.6]);
    expect(v.evidence[0].source).toBe("fetch_text");
  });

  it("R2 fetch login_required", () => {
    const v = run("fetch", FETCH_ERROR_TRACE, { fetch: fetchOf(null, { url: "u", error: "login_required" }) }, { tf_status: "ERROR" });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["auth_wall", 0.9, "R2"]);
  });

  it("R2 login redirect in agent steps", () => {
    const v = run("agent", agentTrace("Navigated to https://github.com/login?return_to=%2Fsettings", "Stopped"), {}, {
      tf_status: "COMPLETED",
      result: null,
    });
    expect(v.failure_class).toBe("auth_wall");
    expect(v.failing_step_seq).toBe(3);
  });

  it("R3 bot_blocked beats a turnstile word in page text", () => {
    const fetch = fetchOf("<div class='cf-turnstile'>Just a moment</div>", { url: "u", error: "bot_blocked" });
    const v = run("fetch", FETCH_ERROR_TRACE, { fetch }, { tf_status: "ERROR" });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["bot_block", 0.9, "R3"]);
  });

  it("R3 throttled fetch", () => {
    const v = run("fetch", FETCH_ERROR_TRACE, { fetch: fetchOf(null, { url: "u", error: "target_http_error", status: 429 }) }, { tf_status: "ERROR" });
    expect(v.failure_class).toBe("bot_block");
  });

  it("R3 site blocked run error", () => {
    const v = run("agent", agentTrace("Loading"), {}, {
      tf_status: "FAILED",
      tf_error: { code: "SITE_BLOCKED", message: "Target site blocked the automation." },
    });
    expect([v.failure_class, v.confidence]).toEqual(["bot_block", 0.9]);
  });

  it("R4 popup like the sample attempt 2", () => {
    const trace = agentTrace(
      "Navigating to https://shop.example.com/products",
      "A cookie consent dialog is covering the page",
      "Looking for the product grid behind the dialog",
      "Could not read any products; finishing",
    );
    const v = run("agent", trace, { expected: MIN3 }, { tf_status: "COMPLETED", result: null });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["popup_overlay", 0.9, "R4"]);
    expect(v.failing_step_seq).toBe(4);
    expect(v.explanation).toBe(
      "A cookie/consent or popup dialog covered the page at step 2, so the agent finished without reading the data.",
    );
    expect(v.evidence.map((e) => [e.source, e.quote, e.event_seq])).toEqual([
      ["trace", "A cookie consent dialog is covering the page", 4],
      ["verifier", "Agent reported COMPLETED but result is null", null],
    ]);
  });

  it("R5 popup text in the result", () => {
    const v = run("agent", agentTrace("Reading"), { expected: MIN3 }, {
      tf_status: "COMPLETED",
      result: { note: "Please accept all cookies to continue", products: [] },
    });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["popup_overlay", 0.8, "R5"]);
  });

  it("R6 needs interaction like the sample attempt 1", () => {
    const hint = "The product grid only says 'Loading products…' behind a cookie notice; it needs a real browser to load.";
    const v = run(
      "fetch",
      FETCH_TRACE,
      {
        expected: MIN3,
        fetch: fetchOf("# Products\n\nLoading products…"),
        extraction: { found: false, result_json: "", missing: ["products"], interaction_hint: hint },
      },
      { tf_status: "OK", result: null },
    );
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["needs_interaction", 0.9, "R6"]);
    expect(v.failing_step_seq).toBe(2);
    expect(v.evidence.map((e) => [e.source, e.event_seq])).toEqual([
      ["trace", 2],
      ["verifier", null],
    ]);
  });

  it("R6 without a hint is less confident", () => {
    const v = run("fetch", FETCH_TRACE, { fetch: fetchOf("text") }, { tf_status: "OK", result: null });
    expect([v.failure_class, v.confidence]).toEqual(["needs_interaction", 0.8]);
  });

  it("R7 misread page", () => {
    const v = run("agent", agentTrace("Reading the availability"), { expected: makeExpected({ type: "regex", value: "\\b22\\b" }) }, {
      tf_status: "COMPLETED",
      result: { copies: "In stock" },
    });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["misread_page", 0.85, "R7"]);
    expect(v.explanation).toContain("no match");
  });

  it("R8 null result without a popup cue defers to the LLM", () => {
    const v = run("agent", agentTrace("Reading"), {}, { tf_status: "COMPLETED", result: null });
    expect([v.failure_class, v.confidence, v.rule]).toEqual(["misread_page", 0.5, "R8"]);
  });

  it("R9 unclassified failure", () => {
    const v = run("agent", agentTrace("Navigating"), {}, { tf_status: "FAILED", tf_error: { code: "TASK_FAILED", message: "navigation failed" } });
    expect([v.failure_class, v.confidence, v.rule]).toEqual([null, 0, "R9"]);
    expect(v.evidence.length > 0 && v.failing_step_seq === 4).toBe(true);
  });
});
