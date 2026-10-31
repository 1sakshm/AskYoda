/**
 * Rule-based failure classifier (pure). Port of apps/api/app/diagnose/rules.py.
 *
 * Two passes: rules R1-R9 run on strong signals (result, steps, TinyFish/Fetch errors, profile
 * hints) and the first match wins; only if nothing matched do R1-R3 run again on weak signals
 * (Fetch page text) at a confidence low enough to defer to the LLM.
 */

import type { FetchResponse } from "./verifier.js";
import { RE_CAPTCHA, RE_LOGIN, RE_LOGIN_URL, RE_POPUP, isBlocking } from "./verifier.js";
import type {
  Attempt,
  BlockSignal,
  BlockSignalKind,
  CheckName,
  Diagnosis,
  Evidence,
  EvidenceSource,
  FailureClass,
  FetchExtraction,
  SignalWhere,
  TraceEvent,
  TraceKind,
  VerifyResult,
} from "./types.js";
import { makeEvidence } from "./types.js";
import { cut, isPlainObject, pyDumps } from "./util.js";

const STRONG_WHERE = new Set<SignalWhere>(["result", "progress", "tf_error", "fetch_error", "profile_hint"]);
const CAPTCHA_KINDS = new Set<BlockSignalKind>(["captcha"]);
const AUTH_KINDS = new Set<BlockSignalKind>(["fetch_login_required", "profile_hint_auth_wall", "login_form"]);
const BOT_KINDS = new Set<BlockSignalKind>([
  "fetch_bot_blocked",
  "site_blocked_error",
  "profile_hint_bot_challenge",
  "access_denied",
  "http_403",
]);
const WEAK_CONFIDENCE = 0.6;

const EXPLAIN: Record<FailureClass, string> = {
  needs_interaction:
    "The data only appears after interacting with the page in a real browser, so a read-only fetch cannot see it.",
  popup_overlay:
    "A cookie/consent or popup dialog covered the page{at_step}, so the agent finished without reading the data.",
  bot_block: "The site served a bot-protection or access-denied page instead of the content.",
  misread_page: "The agent returned data, but it does not match the expected output: {detail}.",
  auth_wall: "The content is behind a login wall.",
  captcha: "The site served a CAPTCHA, which TinyFish cannot solve.",
};

const SOURCE_OF_WHERE: Record<SignalWhere, EvidenceSource> = {
  result: "result",
  progress: "trace",
  tf_error: "tinyfish_error",
  fetch_error: "tinyfish_error",
  fetch_text: "fetch_text",
  profile_hint: "tinyfish_error",
};

export interface RuleVerdict {
  failure_class: FailureClass | null;
  confidence: number;
  failing_step_seq: number | null;
  evidence: Evidence[];
  explanation: string;
  rule: string;
}

export function explain(
  failureClass: FailureClass,
  opts: { stepNo?: number | null; detail?: string } = {},
): string {
  const atStep = opts.stepNo ? ` at step ${opts.stepNo}` : "";
  return EXPLAIN[failureClass].replace("{at_step}", atStep).replace("{detail}", opts.detail || "see the verifier");
}

class Ctx {
  constructor(
    readonly attempt: Attempt,
    readonly vr: VerifyResult,
    readonly trace: TraceEvent[],
    readonly extraction: FetchExtraction | null,
    readonly fetch: FetchResponse | null,
  ) {}

  get isAgent(): boolean {
    return this.attempt.rung !== "fetch";
  }

  first(...kinds: TraceKind[]): TraceEvent | null {
    return this.trace.find((ev) => kinds.includes(ev.kind)) ?? null;
  }

  progressMatching(pattern: RegExp): TraceEvent | null {
    return this.trace.find((ev) => ev.kind === "progress" && pattern.test(ev.label)) ?? null;
  }

  check(name: CheckName): boolean | null {
    const found = this.vr.checks.find((c) => c.name === name);
    return found ? found.passed : null;
  }

  failedDetail(): string | null {
    return this.vr.checks.find((c) => !c.passed)?.detail ?? null;
  }

  signals(kinds: Set<BlockSignalKind>, strong: boolean): BlockSignal[] {
    return this.vr.block_signals.filter((s) => kinds.has(s.kind) && STRONG_WHERE.has(s.where) === strong);
  }

  fetchError(): Record<string, unknown> | null {
    const first = (this.fetch?.errors ?? [])[0];
    return isPlainObject(first) ? first : null;
  }

  fetchFinalUrl(): string {
    const first = (this.fetch?.results ?? [])[0];
    if (isPlainObject(first)) return String(first.final_url || first.url || "");
    return "";
  }
}

function evidenceFor(ctx: Ctx, first: Evidence[]): Evidence[] {
  const evidence = first.filter((e) => e.quote.trim()).slice(0, 2);
  const detail = ctx.failedDetail();
  if (detail) evidence.push(makeEvidence({ source: "verifier", quote: cut(detail, 300) }));
  if (!evidence.length) evidence.push(makeEvidence({ source: "verifier", quote: cut(ctx.vr.summary, 300) }));
  return evidence.slice(0, 3);
}

function signalEvidence(signal: BlockSignal): Evidence {
  return makeEvidence({
    source: SOURCE_OF_WHERE[signal.where],
    quote: cut(signal.evidence, 300),
    event_seq: signal.event_seq,
  });
}

function terminalSeq(ctx: Ctx): number | null {
  const kinds: TraceKind[] = ctx.isAgent ? ["complete"] : ["fetch_error", "fetch_result"];
  const ev = ctx.first(...kinds) ?? (ctx.trace.length ? ctx.trace[ctx.trace.length - 1] : null);
  return ev ? ev.seq : null;
}

function verdict(
  ctx: Ctx,
  cls: FailureClass,
  confidence: number,
  step: TraceEvent | null,
  fallbackSeq: number | null,
  evidence: Evidence[],
  rule: string,
): RuleVerdict {
  const detail = ctx.failedDetail() ?? "";
  return {
    failure_class: cls,
    confidence,
    failing_step_seq: step ? step.seq : fallbackSeq,
    evidence: evidenceFor(ctx, evidence),
    explanation: explain(cls, { stepNo: step ? step.step_no : null, detail }),
    rule,
  };
}

/** R1-R3 (captcha > auth wall > bot block), on strong or weak signals. */
function blockRules(ctx: Ctx, strong: boolean): RuleVerdict | null {
  let confidence = strong ? 0.95 : WEAK_CONFIDENCE;
  const captcha = ctx.signals(CAPTCHA_KINDS, strong);
  if (captcha.length) {
    const step = ctx.progressMatching(RE_CAPTCHA);
    return verdict(ctx, "captcha", confidence, step, captcha[0].event_seq || terminalSeq(ctx), [signalEvidence(captcha[0])], "R1");
  }

  confidence = strong ? 0.9 : WEAK_CONFIDENCE;
  const auth = ctx.signals(AUTH_KINDS, strong);
  const loginStep = ctx.progressMatching(RE_LOGIN_URL) ?? ctx.progressMatching(RE_LOGIN);
  const loginUrl = RE_LOGIN_URL.test(ctx.fetchFinalUrl());
  if (auth.length || (strong && (loginStep || loginUrl))) {
    const evidence = auth.length ? [signalEvidence(auth[0])] : [];
    if (loginUrl && !auth.length) evidence.push(makeEvidence({ source: "tinyfish_error", quote: ctx.fetchFinalUrl() }));
    if (loginStep && !auth.length) {
      evidence.push(makeEvidence({ source: "trace", quote: loginStep.label, event_seq: loginStep.seq }));
    }
    const fallback = auth.length ? auth[0].event_seq : terminalSeq(ctx);
    return verdict(ctx, "auth_wall", confidence, loginStep, fallback, evidence, "R2");
  }

  const bot = ctx.signals(BOT_KINDS, strong);
  const fetchErr = ctx.fetchError();
  const throttled =
    strong &&
    fetchErr !== null &&
    fetchErr.error === "target_http_error" &&
    (fetchErr.status === 403 || fetchErr.status === 429);
  if (bot.length || throttled) {
    const evidence = bot.length
      ? [signalEvidence(bot[0])]
      : [makeEvidence({ source: "tinyfish_error", quote: `target_http_error ${String(fetchErr!.status)}` })];
    const step =
      ctx.trace.find((ev) => bot.length > 0 && ev.kind === "progress" && ev.seq === bot[0].event_seq) ?? null;
    const fallback = bot.length && bot[0].event_seq ? bot[0].event_seq : terminalSeq(ctx);
    return verdict(ctx, "bot_block", confidence, step, fallback, evidence, "R3");
  }
  return null;
}

export function classify(
  attempt: Attempt,
  vr: VerifyResult,
  trace: TraceEvent[],
  _history: Diagnosis[],
  extraction: FetchExtraction | null,
  fetch: FetchResponse | null = null,
): RuleVerdict {
  const ctx = new Ctx(attempt, vr, trace, extraction, fetch);

  // Pass 1: strong signals.
  const strongVerdict = blockRules(ctx, true);
  if (strongVerdict) return strongVerdict;

  const failed = new Set(vr.checks.filter((c) => !c.passed).map((c) => c.name));
  if (ctx.isAgent) {
    const popupStep = ctx.progressMatching(RE_POPUP);
    const contentFailed = failed.has("result_present") || failed.has("expected") || failed.has("not_all_null");
    if (popupStep && contentFailed) {
      // R4
      return verdict(
        ctx,
        "popup_overlay",
        0.9,
        popupStep,
        null,
        [makeEvidence({ source: "trace", quote: popupStep.label, event_seq: popupStep.seq })],
        "R4",
      );
    }
    const resultText = attempt.result ? pyDumps(attempt.result) : "";
    const m = failed.size ? RE_POPUP.exec(resultText) : null;
    if (m) {
      // R5
      const quote = cut(resultText.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60), 300);
      return verdict(ctx, "popup_overlay", 0.8, null, terminalSeq(ctx), [makeEvidence({ source: "result", quote })], "R5");
    }
  } else {
    const fetchErr = ctx.fetchError();
    const empty = fetchErr !== null && fetchErr.error === "empty_content";
    if (empty || failed.has("result_present")) {
      // R6
      const hint = (extraction ? extraction.interaction_hint : "").trim();
      const step = ctx.first("extraction");
      const evidence = hint ? [makeEvidence({ source: "trace", quote: cut(hint, 300), event_seq: step ? step.seq : null })] : [];
      const fallback = step ? step.seq : terminalSeq(ctx);
      return verdict(ctx, "needs_interaction", hint ? 0.9 : 0.8, null, fallback, evidence, "R6");
    }
  }

  const resultOk = ctx.check("result_present") && ctx.check("not_all_null");
  const contentMismatch = failed.has("output_schema") || failed.has("expected");
  const noBlocking = !vr.block_signals.some(isBlocking);
  if (resultOk && contentMismatch && noBlocking) {
    // R7
    const anchor = ctx.isAgent ? ctx.first("complete") : ctx.first("extraction");
    return verdict(ctx, "misread_page", 0.85, null, anchor ? anchor.seq : terminalSeq(ctx), [], "R7");
  }

  if (ctx.isAgent && attempt.tf_status === "COMPLETED" && attempt.result === null) {
    // R8
    return verdict(ctx, "misread_page", 0.5, null, terminalSeq(ctx), [], "R8");
  }

  // Pass 2: weak signals only (Fetch page text).
  const weakVerdict = blockRules(ctx, false);
  if (weakVerdict) return weakVerdict;

  // R9
  return {
    failure_class: null,
    confidence: 0,
    failing_step_seq: terminalSeq(ctx),
    evidence: evidenceFor(ctx, []),
    explanation: "",
    rule: "R9",
  };
}
