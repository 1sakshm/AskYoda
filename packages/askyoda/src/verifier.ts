/**
 * Independent verifier: judges every attempt's result itself.
 *
 * TinyFish documents that `COMPLETED` "means the infrastructure worked, not that your goal
 * succeeded" (null results, all-empty fields and `{"status": "failure"}` all come back COMPLETED),
 * so the agent's status is only the first of seven checks. Port of apps/api/app/verify/verifier.py.
 */

import { pyRepr, toJsonSchema, validateJsonSchema } from "./schema.js";
import type {
  Attempt,
  BlockSignal,
  BlockSignalKind,
  CheckName,
  CheckResult,
  ExpectedCheck,
  RunRequest,
  SignalWhere,
  TraceEvent,
  TraceKind,
  VerifyResult,
} from "./types.js";
import { allEmpty, cut, getPath, isEmpty, isPlainObject, pyDumps } from "./util.js";

// Shared with rules.ts. All case-insensitive.
export const RE_CAPTCHA =
  /captcha|recaptcha|hcaptcha|turnstile|i'?m not a robot|verify (that )?you are (a )?human|press (and|&) hold|are you a robot|human verification/i;
const RE_CAPTCHA_BENIGN = /protected by recaptcha|recaptcha (privacy|terms)/gi;
export const RE_LOGIN =
  /sign in to (continue|view)|log ?in to (continue|view)|please (sign|log) ?in|login required|you must (be )?(signed|logged) in|enter your password|create an account to (continue|view)/i;
export const RE_ACCESS_DENIED =
  /access denied|you (have been|are) blocked|request (was )?blocked|unusual traffic|checking your browser|just a moment\.\.\.|attention required|pardon our interruption|bot detection|security check|forbidden/i;
const RE_403 = /\b403\b/;
export const RE_BOT_VENDOR = /cloudflare|datadome|perimeterx|incapsula|imperva|akamai/i;
export const RE_POPUP =
  /cookie|consent|gdpr|banner|pop-?up|modal|overlay|dialog|newsletter|subscribe|accept all|interstitial/i;
export const RE_LOGIN_URL = /\/(login|log-in|signin|sign-in|sign_in|auth|account\/login)(\b|\/|\?)/i;

const EVIDENCE_PAD = 60;
const FETCH_TEXT_SCAN = 5000;
const FAILURE_STATUSES = new Set(["failure", "failed", "error"]);
const FAILURE_ONLY_KEYS = new Set(["status", "reason", "error", "message"]);

const BLOCKING_ANYWHERE = new Set<BlockSignalKind>([
  "site_blocked_error",
  "fetch_bot_blocked",
  "fetch_login_required",
  "profile_hint_auth_wall",
  "profile_hint_bot_challenge",
]);
const BLOCKING_IN_RESULT = new Set<BlockSignalKind>(["captcha", "login_form", "access_denied"]);

export type FetchResponse = { results?: unknown[]; errors?: unknown[]; [key: string]: unknown };

function firstSeq(trace: TraceEvent[], ...kinds: TraceKind[]): number | null {
  const ev = trace.find((e) => kinds.includes(e.kind));
  return ev ? ev.seq : null;
}

function evidenceAround(text: string, m: RegExpExecArray): string {
  const start = Math.max(0, m.index - EVIDENCE_PAD);
  const end = Math.min(text.length, m.index + m[0].length + EVIDENCE_PAD);
  return cut(text.slice(start, end));
}

// --- Block signals ----------------------------------------------------------------------------

function* signalSources(
  attempt: Attempt,
  trace: TraceEvent[],
  fetch: FetchResponse | null,
): Generator<[SignalWhere, string, number | null]> {
  const completeSeq = firstSeq(trace, "complete");
  if (attempt.result !== null) yield ["result", pyDumps(attempt.result), completeSeq];
  for (const ev of trace) if (ev.kind === "progress") yield ["progress", ev.label, ev.seq];
  const tfError = attempt.tf_error ?? {};
  const errorText = (["code", "message"] as const)
    .filter((k) => tfError[k])
    .map((k) => String(tfError[k]))
    .join(" ");
  if (errorText) yield ["tf_error", errorText, completeSeq];
  if (fetch) {
    const results = fetch.results ?? [];
    const first = results[0];
    const text = isPlainObject(first) ? first.text : null;
    if (typeof text === "string" && text) {
      yield ["fetch_text", text.slice(0, FETCH_TEXT_SCAN), firstSeq(trace, "fetch_result")];
    }
  }
}

/** Every block-like signal in the attempt, blocking or not (the diagnoser uses all of them). */
export function detectSignals(
  attempt: Attempt,
  trace: TraceEvent[],
  fetch: FetchResponse | null,
): BlockSignal[] {
  const signals: BlockSignal[] = [];
  const seen = new Set<string>();
  const add = (kind: BlockSignalKind, where: SignalWhere, evidence: string, seq: number | null) => {
    const key = `${kind}|${where}|${seq}`;
    if (!seen.has(key)) {
      seen.add(key);
      signals.push({ kind, where, evidence: cut(evidence), event_seq: seq });
    }
  };

  for (const [where, text, seq] of signalSources(attempt, trace, fetch)) {
    let m: RegExpExecArray | null;
    if ((m = RE_CAPTCHA.exec(text.replace(RE_CAPTCHA_BENIGN, " ")))) {
      // Same as the original: offsets from the benign-stripped text, quoted from the raw text.
      add("captcha", where, evidenceAround(text, m), seq);
    }
    if ((m = RE_LOGIN.exec(text))) add("login_form", where, evidenceAround(text, m), seq);
    if ((m = RE_ACCESS_DENIED.exec(text))) add("access_denied", where, evidenceAround(text, m), seq);
    if ((where === "result" || where === "tf_error") && (m = RE_403.exec(text))) {
      add("http_403", where, evidenceAround(text, m), seq);
    }
  }

  const completeSeq = firstSeq(trace, "complete");
  const isAgent = attempt.rung !== "fetch";
  if (isAgent && attempt.tf_status === "COMPLETED" && attempt.result === null) {
    add("null_result_completed", "result", "status=COMPLETED, result=null", completeSeq);
  }

  const tfError = attempt.tf_error ?? {};
  if (String(tfError.code ?? "").toUpperCase() === "SITE_BLOCKED") {
    add("site_blocked_error", "tf_error", `SITE_BLOCKED: ${tfError.message ?? ""}`, completeSeq);
  }
  const hint = tfError.profile_hint_reason;
  if (hint === "auth_wall") add("profile_hint_auth_wall", "profile_hint", hint, completeSeq);
  else if (hint === "bot_challenge") add("profile_hint_bot_challenge", "profile_hint", hint, completeSeq);

  const errors = fetch?.errors ?? [];
  const firstErr = errors[0];
  if (isPlainObject(firstErr)) {
    const code = firstErr.error;
    const status = firstErr.status;
    const seq = firstSeq(trace, "fetch_error");
    const text = status ? `${String(code)} ${String(status)}` : String(code);
    if (code === "bot_blocked") add("fetch_bot_blocked", "fetch_error", text, seq);
    else if (code === "login_required") add("fetch_login_required", "fetch_error", text, seq);
    else if (code === "target_http_error" && status === 403) add("http_403", "fetch_error", text, seq);
  }
  return signals;
}

export function isBlocking(signal: BlockSignal): boolean {
  if (BLOCKING_ANYWHERE.has(signal.kind)) return true;
  return BLOCKING_IN_RESULT.has(signal.kind) && signal.where === "result";
}

// --- Checks -----------------------------------------------------------------------------------

function check(name: CheckName, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail: cut(detail) };
}

function statusCheck(attempt: Attempt, fetch: FetchResponse | null): CheckResult {
  if (attempt.rung === "fetch") {
    const results = fetch?.results ?? [];
    if (results.length) return check("tinyfish_status", true, "Fetch returned 1 page");
    const errors = fetch?.errors ?? [];
    const first = errors[0];
    if (isPlainObject(first)) {
      const suffix = first.status ? ` ${String(first.status)}` : "";
      return check("tinyfish_status", false, `Fetch error: ${String(first.error)}${suffix}`);
    }
    const code = (attempt.tf_error ?? {}).code || "no page returned";
    return check("tinyfish_status", false, `Fetch error: ${String(code)}`);
  }
  if (attempt.tf_status === "COMPLETED") return check("tinyfish_status", true, "COMPLETED");
  const err = attempt.tf_error ?? {};
  const parts = [attempt.tf_status || "no status", err.code, err.message];
  return check("tinyfish_status", false, parts.filter((p) => p).map(String).join(" "));
}

function resultPresentCheck(attempt: Attempt): CheckResult {
  const result = attempt.result;
  if (isPlainObject(result) && Object.keys(result).length) {
    const n = Object.keys(result).length;
    return check("result_present", true, `result has ${n} key${n !== 1 ? "s" : ""}`);
  }
  if (attempt.rung === "fetch") {
    return check("result_present", false, "Extractor found no data in the Fetch text");
  }
  if (attempt.tf_status === "COMPLETED" && result === null) {
    return check("result_present", false, "Agent reported COMPLETED but result is null");
  }
  return check("result_present", false, "result is empty");
}

function selfReportedCheck(result: Record<string, unknown>): CheckResult {
  const status = result.status;
  let failed = typeof status === "string" && FAILURE_STATUSES.has(status.trim().toLowerCase());
  failed = failed || !isEmpty(result.error);
  const keys = Object.keys(result);
  failed =
    failed ||
    (keys.every((k) => FAILURE_ONLY_KEYS.has(k)) && keys.some((k) => k === "reason" || k === "error"));
  if (!failed) return check("self_reported_failure", true, "no failure reported in the result");
  const reasonKey = ["reason", "error", "message", "status"].find((k) => !isEmpty(result[k]));
  const reason = reasonKey ? result[reasonKey] : "failure";
  return check("self_reported_failure", false, `result reports failure: ${typeof reason === "string" ? reason : pyRepr(reason)}`);
}

function schemaCheck(result: Record<string, unknown>, schema: Record<string, unknown>): CheckResult {
  const errors = validateJsonSchema(result, toJsonSchema(schema));
  if (!errors.length) return check("output_schema", true, "result matches the output schema");
  const shown = errors
    .slice(0, 3)
    .map((e) => `${e.path.map(String).join("/") || "#"}: ${e.message}`)
    .join("; ");
  return check("output_schema", false, shown);
}

function expectedCheck(result: Record<string, unknown>, expected: ExpectedCheck): CheckResult {
  const haystack = pyDumps(result);
  switch (expected.type) {
    case "contains": {
      const value = expected.value ?? "";
      if (haystack.toLowerCase().includes(value.toLowerCase())) return check("expected", true, `found '${value}'`);
      return check("expected", false, `'${value}' not in result`);
    }
    case "regex": {
      const pattern = expected.value ?? "";
      if (new RegExp(pattern, "i").test(haystack)) return check("expected", true, `matches /${pattern}/`);
      return check("expected", false, `no match for /${pattern}/`);
    }
    case "fields_present": {
      const fields = expected.fields ?? [];
      const missing = fields.filter((f) => isEmpty(getPath(result, f)[1]));
      if (!missing.length) return check("expected", true, `all ${fields.length} fields present`);
      return check("expected", false, `missing or empty: ${missing.join(", ")}`);
    }
    case "min_items": {
      const path = expected.path ?? "";
      const need = expected.min ?? 1;
      const [found, value] = getPath(result, path);
      if (!found || !Array.isArray(value)) return check("expected", false, `${path} not found or not a list`);
      if (value.length >= need) return check("expected", true, `${path} has ${value.length} items (≥ ${need})`);
      return check("expected", false, `${path} has ${value.length} items, need ${need}`);
    }
  }
}

/** Run the checks in spec order. `fetch` is the raw Fetch response for rung-1 attempts. */
export function verify(
  attempt: Attempt,
  request: Pick<RunRequest, "expected">,
  trace: TraceEvent[],
  fetch: FetchResponse | null,
): VerifyResult {
  const checks = [statusCheck(attempt, fetch), resultPresentCheck(attempt)];
  const result = attempt.result;
  if (checks[checks.length - 1].passed && isPlainObject(result)) {
    checks.push(selfReportedCheck(result));
    if (attempt.config.output_schema && Object.keys(attempt.config.output_schema).length) {
      checks.push(schemaCheck(result, attempt.config.output_schema));
    }
    if (request.expected) checks.push(expectedCheck(result, request.expected));
    checks.push(
      allEmpty(result)
        ? check("not_all_null", false, "every field in the result is empty")
        : check("not_all_null", true, "result has non-empty values"),
    );
  }

  const signals = detectSignals(attempt, trace, fetch);
  const blocking = signals.filter(isBlocking);
  if (blocking.length) {
    const first = blocking[0];
    checks.push(check("no_block_page", false, `${first.kind} in ${first.where}: '${first.evidence}'`));
  } else {
    checks.push(check("no_block_page", true, "no blocking page detected"));
  }

  const passed = checks.every((c) => c.passed);
  let summary: string;
  if (passed) {
    const exp = checks.find((c) => c.name === "expected");
    summary = "Verified: " + (exp ? exp.detail : "result passed all checks");
  } else {
    summary = "Rejected: " + checks.find((c) => !c.passed)!.detail;
  }
  return { attempt_no: attempt.attempt_no, passed, checks, block_signals: signals, summary: cut(summary) };
}
