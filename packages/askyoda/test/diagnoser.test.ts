import { describe, expect, it } from "vitest";

import { diagnose } from "../src/diagnoser.js";
import { buildUserMessage, extractFromFetch } from "../src/extract.js";
import type { Attempt, FetchExtraction, LlmDiagnosis, TraceEvent } from "../src/types.js";
import { makeExpected } from "../src/types.js";
import { verify } from "../src/verifier.js";
import { FakeLlm, SAMPLE_PAGE, attemptOf, ev } from "./fakes.js";

const REQ = { url: "https://x.example", goal: "List the products", expected: null };

async function runDiagnose(attempt: Attempt, trace: TraceEvent[], llm: FakeLlm | null) {
  const vr = verify(attempt, REQ, trace, null);
  return diagnose({
    attempt,
    vr,
    trace,
    fetch: null,
    fetchText: null,
    extraction: null,
    history: [],
    planCtx: { rung: "agent", request: REQ },
    llm,
    threshold: 0.8,
    goal: REQ.goal,
    url: REQ.url,
  });
}

const POPUP_TRACE = [ev(1, "started"), ev(2, "progress", "A cookie consent dialog is covering the page", { stepNo: 1 }), ev(3, "complete")];
const VAGUE_TRACE = [
  ev(1, "started"),
  ev(2, "progress", "Opened the store page", { stepNo: 1 }),
  ev(3, "progress", "Waited for the grid", { stepNo: 2 }),
  ev(4, "complete"),
];

const llmDiag = (overrides: Partial<LlmDiagnosis> = {}): LlmDiagnosis => ({
  failure_class: "needs_interaction",
  confidence: 0.7,
  failing_step_seq: 3,
  evidence_quotes: ["Waited for the grid", "this quote is invented"],
  explanation: "The products only load after scrolling.",
  suggested_goal_prefix: "",
  suggested_goal_suffix: "Scroll down until products appear.",
  ...overrides,
});
const nullResult = () => attemptOf("agent", { tf_status: "COMPLETED", result: null });

describe("diagnose", () => {
  it("never calls the LLM when a rule is confident", async () => {
    const llm = new FakeLlm({ diagnosis: [llmDiag()] });
    const d = await runDiagnose(nullResult(), POPUP_TRACE, llm);
    expect([d.failure_class, d.source]).toEqual(["popup_overlay", "rules"]);
    expect([d.failing_step_seq, d.failing_step_label]).toEqual([2, "A cookie consent dialog is covering the page"]);
    expect(llm.calls).toEqual([]);
  });

  it("asks the LLM when unsure and keeps only verbatim quotes", async () => {
    const llm = new FakeLlm({ diagnosis: [llmDiag()] });
    const d = await runDiagnose(nullResult(), VAGUE_TRACE, llm);
    expect([d.failure_class, d.source, d.confidence]).toEqual(["needs_interaction", "llm", 0.7]);
    expect(d.evidence.map((e) => [e.source, e.quote, e.event_seq])).toEqual([["trace", "Waited for the grid", 3]]);
    expect(d.failing_step_label).toBe("Waited for the grid");
    const call = llm.callsFor("diagnosis")[0];
    expect(call.system).toContain("untrusted data");
    expect(call.user).toContain('"rule_guess"');
    expect(call.user).toContain('"misread_page"');
  });

  it("sanitizes the LLM answer", async () => {
    const llm = new FakeLlm({ diagnosis: [llmDiag({ confidence: 7, failing_step_seq: 99, evidence_quotes: ["nope"] })] });
    const d = await runDiagnose(nullResult(), VAGUE_TRACE, llm);
    expect(d.confidence).toBe(1);
    expect(d.failing_step_seq).toBe(4);
    expect(d.evidence[0].source).toBe("verifier");
  });

  it("falls back to the rule when the LLM fails", async () => {
    const llm = new FakeLlm({ diagnosis: [{ parsed: null, error: "refusal", stopReason: "refusal" }] });
    const d = await runDiagnose(nullResult(), VAGUE_TRACE, llm);
    expect([d.failure_class, d.source]).toEqual(["misread_page", "rules_fallback"]);
    expect(d.explanation.endsWith("(automatic diagnosis unavailable: refusal)")).toBe(true);
  });

  it("uses the default class with no LLM and no rule", async () => {
    const d = await runDiagnose(attemptOf("agent", { tf_status: "FAILED", tf_error: { code: "TASK_FAILED", message: "x" } }), VAGUE_TRACE, null);
    expect([d.failure_class, d.source, d.confidence]).toEqual(["misread_page", "rules_fallback", 0.4]);
    expect(d.explanation).not.toContain("automatic diagnosis unavailable");
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it("stops the run on an unrecoverable class from the LLM", async () => {
    const llm = new FakeLlm({ diagnosis: [llmDiag({ failure_class: "captcha" })] });
    const d = await runDiagnose(nullResult(), VAGUE_TRACE, llm);
    expect(d.recoverable).toBe(false);
    expect(d.patch.stop).toBe(true);
    expect(d.patch.stop_reason).toContain("CAPTCHA");
  });
});

const NOT_FOUND: FetchExtraction = {
  found: false,
  result_json: "",
  missing: ["products"],
  interaction_hint: "The product grid only says 'Loading products…'; it needs a real browser.",
};
const FOUND: FetchExtraction = { found: true, result_json: '{"title": "Acme"}', missing: [], interaction_hint: "" };

describe("extractFromFetch", () => {
  it("marks truncation explicitly in the user message", () => {
    const msg = buildUserMessage({ goal: "g", outputSchema: null, expected: null, page: { ...SAMPLE_PAGE, text: "x".repeat(120) }, maxChars: 100 });
    expect(msg).toContain("[truncated: 20 chars omitted]");
    expect(msg).toContain("<<<PAGE");
    expect(msg).toContain("PAGE>>>");
    expect(msg).toContain("OUTPUT SCHEMA: none");
  });

  it("handles found, not found and errors", async () => {
    const kw = { goal: "g", outputSchema: null, expected: null, page: SAMPLE_PAGE, maxChars: 1000 };
    let [result, extraction, err] = await extractFromFetch(new FakeLlm({ fetch_extraction: [FOUND] }), kw);
    expect([result, err]).toEqual([{ title: "Acme" }, null]);

    [result, extraction, err] = await extractFromFetch(new FakeLlm({ fetch_extraction: [NOT_FOUND] }), kw);
    expect(result).toBeNull();
    expect(extraction).toEqual(NOT_FOUND);
    expect(err).toBeNull();

    [result, , err] = await extractFromFetch(new FakeLlm({ fetch_extraction: [{ ...FOUND, result_json: "[1, 2]" }] }), kw);
    expect(result).toBeNull();
    expect(err).toBe("result_json was not a JSON object");

    [result, extraction, err] = await extractFromFetch(new FakeLlm({ fetch_extraction: [{ parsed: null, error: "refusal" }] }), kw);
    expect([result, extraction, err]).toEqual([null, null, "refusal"]);
  });

  it("skips the LLM when the expected value is missing from the page", async () => {
    const llm = new FakeLlm({ fetch_extraction: [FOUND] });
    const [result, extraction, err] = await extractFromFetch(llm, {
      goal: "g",
      outputSchema: null,
      expected: makeExpected({ type: "regex", value: "\\b22\\b" }),
      page: SAMPLE_PAGE,
      maxChars: 1000,
    });
    expect([result, err]).toEqual([null, null]);
    expect(extraction!.found).toBe(false);
    expect(extraction!.missing).toEqual(["expected '\\b22\\b'"]);
    expect(llm.calls).toEqual([]);
  });
});
