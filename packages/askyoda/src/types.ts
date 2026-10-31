/**
 * Data model. Field names are snake_case on purpose: every object here has the same JSON shape
 * as the AskYoda web API (apps/api/app/models.py), so events and runs can be stored, replayed or
 * streamed to the AskYoda web UI unchanged.
 */

export type FailureClass =
  | "needs_interaction"
  | "popup_overlay"
  | "bot_block"
  | "misread_page"
  | "auth_wall"
  | "captcha";

export type Rung = "fetch" | "agent" | "agent_stealth";

export type ExpectedCheckType = "contains" | "regex" | "fields_present" | "min_items";

export type TraceKind =
  | "started"
  | "live_view"
  | "progress"
  | "heartbeat"
  | "complete"
  | "tf_api_result"
  | "fetch_result"
  | "fetch_error"
  | "extraction"
  | "run_snapshot"
  | "stream_error"
  | "system"
  | "unknown";

export type TraceSource =
  | "tinyfish_sse"
  | "tinyfish_fetch"
  | "tinyfish_runs"
  | "claude_extract"
  | "system";

export type CheckName =
  | "tinyfish_status"
  | "result_present"
  | "self_reported_failure"
  | "output_schema"
  | "expected"
  | "not_all_null"
  | "no_block_page";

export type BlockSignalKind =
  | "access_denied"
  | "http_403"
  | "login_form"
  | "captcha"
  | "null_result_completed"
  | "site_blocked_error"
  | "profile_hint_auth_wall"
  | "profile_hint_bot_challenge"
  | "fetch_bot_blocked"
  | "fetch_login_required";

export type SignalWhere =
  | "result"
  | "progress"
  | "tf_error"
  | "fetch_error"
  | "fetch_text"
  | "profile_hint";

export type EvidenceSource = "trace" | "result" | "fetch_text" | "verifier" | "tinyfish_error";

export type DiagnosisSource = "rules" | "llm" | "rules_fallback";

export type AttemptOutcome = "verified" | "rejected" | "cancelled_budget" | "error";

/** Internal run status (same values as the web API). `unrecoverable` = needs a human. */
export type RunStatus =
  | "queued"
  | "running"
  | "verified"
  | "unrecoverable"
  | "budget_exhausted"
  | "error"
  | "cancelled";

export type BrowserProfile = "lite" | "stealth";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const RUNG_ORDER: Rung[] = ["fetch", "agent", "agent_stealth"];
export const RECOVERABLE: ReadonlySet<FailureClass> = new Set<FailureClass>([
  "needs_interaction",
  "popup_overlay",
  "bot_block",
  "misread_page",
]);
export const RUNG_LABEL: Record<Rung, string> = {
  fetch: "Rung 1 · Fetch",
  agent: "Rung 2 · Agent",
  agent_stealth: "Rung 3 · Agent + stealth + proxy",
};

// --- Requests and attempt config -------------------------------------------------------------

export interface ExpectedCheck {
  type: ExpectedCheckType;
  value: string | null;
  fields: string[] | null;
  path: string | null;
  min: number | null;
}

export interface RunRequest {
  url: string;
  goal: string;
  expected: ExpectedCheck | null;
  output_schema: JsonObject | null;
  start_rung: Rung;
}

export interface AttemptConfig {
  attempt_no: number;
  rung: Rung;
  url: string;
  goal: string;
  output_schema: JsonObject | null;
  browser_profile: BrowserProfile;
  proxy_enabled: boolean;
  proxy_country: string | null;
  max_duration_seconds: number;
  from_fetch_cache: boolean;
  patches_applied: string[];
  credit_limit: number;
}

// --- Trace, verification, diagnosis ----------------------------------------------------------

export interface TraceEvent {
  run_id: string;
  attempt_no: number;
  seq: number;
  kind: TraceKind;
  source: TraceSource;
  ts: string;
  tf_timestamp: string | null;
  tf_run_id: string | null;
  step_no: number | null;
  label: string;
  raw: { [key: string]: unknown };
}

export interface CheckResult {
  name: CheckName;
  passed: boolean;
  detail: string;
}

export interface BlockSignal {
  kind: BlockSignalKind;
  where: SignalWhere;
  evidence: string;
  event_seq: number | null;
}

export interface VerifyResult {
  attempt_no: number;
  passed: boolean;
  checks: CheckResult[];
  block_signals: BlockSignal[];
  summary: string;
}

export interface Evidence {
  source: EvidenceSource;
  quote: string;
  event_seq: number | null;
}

export interface Patch {
  next_rung: Rung | null;
  skip_rungs: Rung[];
  goal_prefix: string | null;
  goal_suffix: string | null;
  output_schema: JsonObject | null;
  browser_profile: BrowserProfile | null;
  proxy_enabled: boolean | null;
  reextract_from_fetch: boolean;
  stop: boolean;
  stop_reason: string | null;
  summary: string[];
}

export interface Diagnosis {
  attempt_no: number;
  failure_class: FailureClass;
  recoverable: boolean;
  confidence: number;
  failing_step_seq: number | null;
  failing_step_label: string | null;
  evidence: Evidence[];
  explanation: string;
  patch: Patch;
  source: DiagnosisSource;
}

// --- Attempts and runs -----------------------------------------------------------------------

export interface TinyFishErrorInfo {
  [key: string]: unknown;
  code?: string | null;
  message?: string | null;
}

export interface Attempt {
  attempt_no: number;
  rung: Rung;
  config: AttemptConfig;
  started_at: string;
  finished_at: string | null;
  tf_run_id: string | null;
  streaming_url: string | null;
  tf_status: string | null;
  tf_error: TinyFishErrorInfo | null;
  result: JsonObject | null;
  progress_count: number;
  num_of_steps: number | null;
  credits_estimated: number;
  verify: VerifyResult | null;
  diagnosis: Diagnosis | null;
  outcome: AttemptOutcome | null;
}

export interface Run {
  id: string;
  created_at: string;
  finished_at: string | null;
  request: RunRequest;
  status: RunStatus;
  attempts: Attempt[];
  credits_used: number;
  max_attempts: number;
  max_credits: number;
  final_result: JsonObject | null;
  verdict_reason: string | null;
  baseline_credits_estimate: number | null;
}

// --- Events (same shape as the web API's UI events) ------------------------------------------

interface EventBase {
  seq: number;
  run_id: string;
  ts: string;
}

export interface AttemptStartedEvent extends EventBase {
  type: "attempt_started";
  attempt_no: number;
  rung: Rung;
  config: AttemptConfig;
}

export interface TraceUiEvent extends EventBase {
  type: "trace_event";
  attempt_no: number;
  event: TraceEvent;
}

export interface LiveViewEvent extends EventBase {
  type: "live_view";
  attempt_no: number;
  streaming_url: string;
}

export interface VerifyEvent extends EventBase {
  type: "verify";
  attempt_no: number;
  result: VerifyResult;
}

export interface DiagnosisEvent extends EventBase {
  type: "diagnosis";
  attempt_no: number;
  diagnosis: Diagnosis;
}

export interface RungChangeEvent extends EventBase {
  type: "rung_change";
  from_rung: Rung | null;
  to_rung: Rung;
  skipped: Rung[];
  reason: string;
}

export interface BudgetEvent extends EventBase {
  type: "budget";
  attempts_used: number;
  max_attempts: number;
  credits_used: number;
  max_credits: number;
}

export interface VerdictEvent extends EventBase {
  type: "verdict";
  status: RunStatus;
  reason: string;
  final_result: JsonObject | null;
  attempts_used: number;
  credits_used: number;
  baseline_credits_estimate: number | null;
}

export type AskYodaEvent =
  | AttemptStartedEvent
  | TraceUiEvent
  | LiveViewEvent
  | VerifyEvent
  | DiagnosisEvent
  | RungChangeEvent
  | BudgetEvent
  | VerdictEvent;

// --- LLM structured outputs (kept flat on purpose) -------------------------------------------

export interface FetchExtraction {
  found: boolean;
  result_json: string;
  missing: string[];
  interaction_hint: string;
}

export interface LlmDiagnosis {
  failure_class: FailureClass;
  confidence: number;
  failing_step_seq: number | null;
  evidence_quotes: string[];
  explanation: string;
  suggested_goal_prefix: string;
  suggested_goal_suffix: string;
}

// --- Factories (every field present, so JSON matches the web API exactly) ---------------------

export function makeExpected(e: Partial<ExpectedCheck> & { type: ExpectedCheckType }): ExpectedCheck {
  return {
    type: e.type,
    value: e.value ?? null,
    fields: e.fields ?? null,
    path: e.path ?? null,
    min: e.min ?? null,
  };
}

export function makePatch(p: Partial<Patch> = {}): Patch {
  const patch: Patch = {
    next_rung: p.next_rung ?? null,
    skip_rungs: p.skip_rungs ?? [],
    goal_prefix: p.goal_prefix ?? null,
    goal_suffix: p.goal_suffix ?? null,
    output_schema: p.output_schema ?? null,
    browser_profile: p.browser_profile ?? null,
    proxy_enabled: p.proxy_enabled ?? null,
    reextract_from_fetch: p.reextract_from_fetch ?? false,
    stop: p.stop ?? false,
    stop_reason: p.stop_reason ?? null,
    summary: p.summary ?? [],
  };
  if (patch.stop && !patch.stop_reason) {
    throw new Error("patch.stop_reason is required when patch.stop is true");
  }
  return patch;
}

export function makeEvidence(e: Partial<Evidence> & Pick<Evidence, "source" | "quote">): Evidence {
  return { source: e.source, quote: e.quote, event_seq: e.event_seq ?? null };
}

export function makeConfig(
  c: Partial<AttemptConfig> &
    Pick<AttemptConfig, "attempt_no" | "rung" | "url" | "goal" | "max_duration_seconds" | "credit_limit">,
): AttemptConfig {
  return {
    attempt_no: c.attempt_no,
    rung: c.rung,
    url: c.url,
    goal: c.goal,
    output_schema: c.output_schema ?? null,
    browser_profile: c.browser_profile ?? "lite",
    proxy_enabled: c.proxy_enabled ?? false,
    proxy_country: c.proxy_country ?? null,
    max_duration_seconds: c.max_duration_seconds,
    from_fetch_cache: c.from_fetch_cache ?? false,
    patches_applied: c.patches_applied ?? [],
    credit_limit: c.credit_limit,
  };
}

export function makeAttempt(
  a: Partial<Attempt> & Pick<Attempt, "attempt_no" | "rung" | "config" | "started_at">,
): Attempt {
  return {
    attempt_no: a.attempt_no,
    rung: a.rung,
    config: a.config,
    started_at: a.started_at,
    finished_at: a.finished_at ?? null,
    tf_run_id: a.tf_run_id ?? null,
    streaming_url: a.streaming_url ?? null,
    tf_status: a.tf_status ?? null,
    tf_error: a.tf_error ?? null,
    result: a.result ?? null,
    progress_count: a.progress_count ?? 0,
    num_of_steps: a.num_of_steps ?? null,
    credits_estimated: a.credits_estimated ?? 0,
    verify: a.verify ?? null,
    diagnosis: a.diagnosis ?? null,
    outcome: a.outcome ?? null,
  };
}

export function makeTraceEvent(
  e: Partial<TraceEvent> & Pick<TraceEvent, "run_id" | "attempt_no" | "seq" | "kind" | "source" | "label">,
): TraceEvent {
  return {
    run_id: e.run_id,
    attempt_no: e.attempt_no,
    seq: e.seq,
    kind: e.kind,
    source: e.source,
    ts: e.ts ?? new Date().toISOString(),
    tf_timestamp: e.tf_timestamp ?? null,
    tf_run_id: e.tf_run_id ?? null,
    step_no: e.step_no ?? null,
    label: e.label,
    raw: e.raw ?? {},
  };
}
