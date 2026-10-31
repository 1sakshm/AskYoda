/**
 * Ladder controller: runs attempts, enforces the budget, and emits every event.
 * Port of apps/api/app/ladder/controller.py, without the database (the run lives in memory and
 * is returned; events go to a callback).
 */

import { diagnose } from "./diagnoser.js";
import { extractFromFetch } from "./extract.js";
import type { LlmProvider } from "./llm.js";
import { composeGoal, type PlanContext } from "./planner.js";
import { explain } from "./rules.js";
import type { TinyFishApi } from "./tinyfish.js";
import {
  TinyFishConnectError,
  TinyFishError,
  buildAgentBody,
  mapSseEvent,
  normalizeTfError,
  uiCopy,
} from "./tinyfish.js";
import type {
  AskYodaEvent,
  Attempt,
  AttemptConfig,
  Diagnosis,
  FetchExtraction,
  JsonObject,
  Run,
  Rung,
  RunStatus,
  TraceEvent,
  TraceKind,
  TraceSource,
  VerifyResult,
} from "./types.js";
import { RUNG_LABEL, makeAttempt, makeConfig } from "./types.js";
import { verify, type FetchResponse } from "./verifier.js";
import { defaultSleep, isPlainObject, nowIso } from "./util.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;
const CANCEL_GRACE_MS = 15_000;
const WATCHDOG_EXTRA_S = 60;
const RETRY_BEFORE_START_MS = 5000;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
/** TinyFish refusals that another attempt cannot fix. */
const HARD_STOP_CODES = new Set([
  "INSUFFICIENT_CREDITS",
  "FREE_ALLOWANCE_EXHAUSTED",
  "FORBIDDEN",
  "INVALID_API_KEY",
  "MISSING_API_KEY",
  "UNAUTHORIZED",
  "INVALID_INPUT",
]);

export interface LadderSettings {
  proxyCountry: string;
  agentMaxDurationS: number;
  agentMinCredits: number;
  rulesConfidenceThreshold: number;
  fetchTextMaxChars: number;
  baselineDefaultSteps: number;
}

export const DEFAULT_SETTINGS: LadderSettings = {
  proxyCountry: "US",
  agentMaxDurationS: 150,
  agentMinCredits: 3,
  rulesConfidenceThreshold: 0.8,
  fetchTextMaxChars: 12000,
  baselineDefaultSteps: 15,
};

export type EventSink = (event: AskYodaEvent) => void | Promise<void>;

class UserCancelled extends Error {
  override readonly name = "UserCancelled";
}

class WatchdogTimeout extends Error {
  override readonly name = "WatchdogTimeout";
}

/** Assigns each event its seq and hands it to the sink. */
class Emitter {
  private seq = 0;
  constructor(
    readonly runId: string,
    private readonly sink: EventSink,
  ) {}

  private async emit(event: Record<string, unknown>): Promise<void> {
    this.seq += 1;
    const { type, ...rest } = event;
    await this.sink({ type, seq: this.seq, run_id: this.runId, ts: nowIso(), ...rest } as AskYodaEvent);
  }

  budget(attempts_used: number, max_attempts: number, credits_used: number, max_credits: number) {
    return this.emit({ type: "budget", attempts_used, max_attempts, credits_used, max_credits });
  }
  rungChange(from_rung: Rung | null, to_rung: Rung, skipped: Rung[], reason: string) {
    return this.emit({ type: "rung_change", from_rung, to_rung, skipped, reason });
  }
  attemptStarted(cfg: AttemptConfig) {
    return this.emit({ type: "attempt_started", attempt_no: cfg.attempt_no, rung: cfg.rung, config: cfg });
  }
  async trace(ev: TraceEvent) {
    if (ev.kind !== "heartbeat") await this.emit({ type: "trace_event", attempt_no: ev.attempt_no, event: uiCopy(ev) });
  }
  liveView(attempt_no: number, streaming_url: string) {
    return this.emit({ type: "live_view", attempt_no, streaming_url });
  }
  verify(result: VerifyResult) {
    return this.emit({ type: "verify", attempt_no: result.attempt_no, result });
  }
  diagnosis(diagnosis: Diagnosis) {
    return this.emit({ type: "diagnosis", attempt_no: diagnosis.attempt_no, diagnosis });
  }
  verdict(
    status: RunStatus,
    reason: string,
    o: { final_result: JsonObject | null; attempts_used: number; credits_used: number; baseline_credits_estimate: number | null },
  ) {
    return this.emit({ type: "verdict", status, reason, ...o });
  }
}

/** Collects one attempt's trace events and emits each as it is recorded. */
class Trace {
  readonly events: TraceEvent[] = [];
  private seq = 0;
  constructor(
    readonly em: Emitter,
    readonly runId: string,
    readonly attemptNo: number,
  ) {}

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  async record(ev: TraceEvent): Promise<TraceEvent> {
    this.events.push(ev);
    await this.em.trace(ev);
    return ev;
  }

  note(
    kind: TraceKind,
    label: string,
    raw: Record<string, unknown> | null = null,
    opts: { source?: TraceSource; tfRunId?: string | null } = {},
  ): Promise<TraceEvent> {
    return this.record({
      run_id: this.runId,
      attempt_no: this.attemptNo,
      seq: this.nextSeq(),
      kind,
      source: opts.source ?? "system",
      ts: nowIso(),
      tf_timestamp: null,
      tf_run_id: opts.tfRunId ?? null,
      step_no: null,
      label,
      raw: raw ?? {},
    });
  }
}

interface RunState {
  run: Run;
  em: Emitter;
  rung: Rung;
  schema: JsonObject | null;
  skipped: Set<Rung>;
  prefixes: string[];
  suffixes: string[];
  fromFetchCache: boolean;
  fetchRaw: FetchResponse | null;
  fetchText: string | null;
  extraction: FetchExtraction | null;
  reextractTried: boolean;
  history: Diagnosis[];
  historyRungs: Rung[];
  patchesApplied: string[];
  schemaEntitled: boolean;
  active: [Attempt, Trace] | null;
}

function firstPage(fetchRaw: FetchResponse | null): Record<string, unknown> | null {
  const results = fetchRaw?.results ?? [];
  return results.length && isPlainObject(results[0]) ? results[0] : null;
}

/** Copy status/result/error from a COMPLETE event or a run object onto the attempt. */
function applyComplete(attempt: Attempt, obj: Record<string, unknown>): void {
  attempt.tf_status = typeof obj.status === "string" ? obj.status : null;
  let result = obj.result;
  if (result !== null && result !== undefined && !isPlainObject(result)) result = { value: result };
  attempt.result = (result ?? null) as JsonObject | null;
  attempt.tf_error = normalizeTfError(obj);
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export interface LadderOptions {
  tinyfish: TinyFishApi;
  llm: LlmProvider | null;
  settings?: Partial<LadderSettings>;
  onEvent?: EventSink;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class LadderController {
  readonly settings: LadderSettings;
  private readonly tinyfish: TinyFishApi;
  private readonly llm: LlmProvider | null;
  private readonly sink: EventSink;
  private readonly signal: AbortSignal | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: LadderOptions) {
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
    this.tinyfish = opts.tinyfish;
    this.llm = opts.llm;
    this.sink = opts.onEvent ?? (() => {});
    this.signal = opts.signal;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private checkCancelled(): void {
    if (this.signal?.aborted) throw new UserCancelled("cancelled");
  }

  // --- Config ---------------------------------------------------------------------------------

  private buildConfig(st: RunState, attemptNo: number): AttemptConfig {
    const run = st.run;
    const stealth = st.rung === "agent_stealth";
    return makeConfig({
      attempt_no: attemptNo,
      rung: st.rung,
      url: run.request.url,
      goal: composeGoal(run.request.goal, st.prefixes, st.suffixes),
      output_schema: st.schemaEntitled ? st.schema : null,
      browser_profile: stealth ? "stealth" : "lite",
      proxy_enabled: stealth,
      proxy_country: stealth ? this.settings.proxyCountry : null,
      max_duration_seconds: this.settings.agentMaxDurationS,
      from_fetch_cache: st.rung === "fetch" && st.fromFetchCache,
      patches_applied: [...st.patchesApplied],
      credit_limit: st.rung === "fetch" ? 0 : Math.max(0, run.max_credits - run.credits_used),
    });
  }

  // --- Agent attempt --------------------------------------------------------------------------

  private async safeCancel(tfRunId: string): Promise<void> {
    try {
      await this.tinyfish.cancel(tfRunId);
    } catch {
      /* best effort */
    }
  }

  private async pollUntilTerminal(tfRunId: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkCancelled();
      try {
        const runObj = await this.tinyfish.getRun(tfRunId);
        if (TERMINAL_STATUSES.has(String(runObj.status))) return runObj;
      } catch {
        /* keep polling */
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    return null;
  }

  /** Consume the SSE stream. Returns [progressCount, completed, cancelledAtLimit]. */
  private async stream(attempt: Attempt, tr: Trace, cfg: AttemptConfig, signal: AbortSignal): Promise<[number, boolean, boolean]> {
    let progress = 0;
    let cancelled = false;
    let cancelDeadline = 0;
    const body = buildAgentBody(cfg);
    for (const tryNo of [1, 2]) {
      try {
        for await (const raw of this.tinyfish.agentStream(body, signal)) {
          if (signal.aborted) throw signal.reason ?? new Error("aborted");
          const isProgress = raw.type === "PROGRESS";
          if (isProgress) {
            progress += 1;
            attempt.progress_count = progress;
          }
          const ev = mapSseEvent(raw, {
            runId: tr.runId,
            attemptNo: tr.attemptNo,
            seq: tr.nextSeq(),
            stepNo: isProgress ? progress : null,
            now: nowIso(),
          });
          await tr.record(ev);
          const kind = raw.type;
          if (kind === "STARTED" && ev.tf_run_id) {
            attempt.tf_run_id = ev.tf_run_id;
          } else if (kind === "STREAMING_URL" && typeof raw.streaming_url === "string") {
            attempt.streaming_url = raw.streaming_url;
            await tr.em.liveView(cfg.attempt_no, raw.streaming_url);
          } else if (kind === "COMPLETE") {
            applyComplete(attempt, raw);
            return [progress, true, cancelled];
          }
          if (isProgress && !cancelled && progress >= cfg.credit_limit) {
            cancelled = true;
            cancelDeadline = Date.now() + CANCEL_GRACE_MS;
            if (attempt.tf_run_id) await this.safeCancel(attempt.tf_run_id);
            await tr.note("system", `Cancelled at the credit limit (${cfg.credit_limit})`);
          }
          if (cancelled && Date.now() > cancelDeadline) break;
        }
        return [progress, false, cancelled];
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof TinyFishError) {
          const retryable = e.httpStatus === 429 || e.httpStatus === 503;
          if (attempt.tf_run_id === null && retryable && tryNo === 1) {
            await tr.note("stream_error", `TinyFish ${e.code}; retrying once in ${RETRY_BEFORE_START_MS / 1000}s`, e.asDict());
            await this.sleep(RETRY_BEFORE_START_MS);
            continue;
          }
          attempt.outcome = "error";
          attempt.tf_error = e.asDict();
          await tr.note("stream_error", `TinyFish refused the run: ${e.code}`, e.asDict());
          return [progress, false, cancelled];
        }
        // Couldn't reach TinyFish before a run existed: our network, not the site. Retry once
        // instead of handing the diagnoser a failure the site didn't cause.
        const unreached = e instanceof TinyFishConnectError;
        const name = e instanceof Error ? e.name : "Error";
        if (attempt.tf_run_id === null && unreached && tryNo === 1) {
          await tr.note("stream_error", `Stream error: ${name}; retrying once in ${RETRY_BEFORE_START_MS / 1000}s`);
          await this.sleep(RETRY_BEFORE_START_MS);
          continue;
        }
        await tr.note("stream_error", `Stream error: ${name}`);
        return [progress, false, cancelled];
      }
    }
    return [progress, false, cancelled];
  }

  async runAgentAttempt(st: RunState, cfg: AttemptConfig): Promise<[Attempt, TraceEvent[]]> {
    const attempt = makeAttempt({ attempt_no: cfg.attempt_no, rung: cfg.rung, config: cfg, started_at: nowIso() });
    const tr = new Trace(st.em, st.run.id, cfg.attempt_no);
    st.active = [attempt, tr];
    let completed = false;
    let cancelled = false;
    const watchdogS = cfg.max_duration_seconds + WATCHDOG_EXTRA_S;
    const watchdog = new AbortController();
    const timer = setTimeout(() => watchdog.abort(new WatchdogTimeout("watchdog")), watchdogS * 1000);
    const signal = anySignal([watchdog.signal, this.signal]);
    try {
      [, completed, cancelled] = await this.stream(attempt, tr, cfg, signal);
    } catch (e) {
      if (this.signal?.aborted) throw new UserCancelled("cancelled");
      if (!watchdog.signal.aborted) throw e;
      await tr.note("stream_error", `No result after ${watchdogS}s; cancelling`);
      if (attempt.tf_run_id) await this.safeCancel(attempt.tf_run_id);
    } finally {
      clearTimeout(timer);
    }

    if (!completed && attempt.outcome !== "error") {
      if (attempt.tf_run_id) {
        await tr.note("stream_error", "Stream dropped — polling the run status");
        const runObj = await this.pollUntilTerminal(attempt.tf_run_id, POLL_TIMEOUT_MS);
        if (runObj !== null) {
          applyComplete(attempt, runObj);
          completed = true;
          await tr.record({
            run_id: tr.runId,
            attempt_no: tr.attemptNo,
            seq: tr.nextSeq(),
            kind: "complete",
            source: "tinyfish_runs",
            ts: nowIso(),
            tf_timestamp: null,
            tf_run_id: attempt.tf_run_id,
            step_no: null,
            label: `Agent finished: ${String(runObj.status)}`,
            raw: runObj,
          });
        } else {
          await this.safeCancel(attempt.tf_run_id);
          attempt.outcome = "error";
          attempt.tf_error = { code: "STREAM_LOST", message: "no terminal status" };
        }
      } else {
        attempt.outcome = "error";
        attempt.tf_error = attempt.tf_error ?? {
          code: "NO_RUN",
          message: "the stream ended before TinyFish started a run",
        };
      }
    }

    if (attempt.tf_run_id) {
      try {
        const snap = await this.tinyfish.getRun(attempt.tf_run_id, "none");
        const steps = snap.num_of_steps;
        attempt.num_of_steps = typeof steps === "number" && Number.isInteger(steps) ? steps : null;
        const browserConfig = isPlainObject(snap.browser_config) ? snap.browser_config : {};
        const proxyOn = Boolean(browserConfig.proxy_enabled);
        await tr.note("run_snapshot", `Run record: ${steps === undefined || steps === null ? "None" : String(steps)} steps, proxy ${proxyOn ? "on" : "off"}`, snap, {
          source: "tinyfish_runs",
          tfRunId: attempt.tf_run_id,
        });
        if (cfg.proxy_enabled && "browser_config" in snap && !proxyOn) {
          await tr.note("system", "Warning: TinyFish reports the proxy was not applied");
        }
      } catch (e) {
        await tr.note("stream_error", `Could not read the run record: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    attempt.credits_estimated = attempt.num_of_steps !== null ? attempt.num_of_steps : attempt.progress_count;
    if (cancelled) attempt.outcome = "cancelled_budget";
    attempt.finished_at = nowIso();
    return [attempt, tr.events];
  }

  // --- Fetch attempt (rung 1) -----------------------------------------------------------------

  /** Fetch the page (or reuse the cached text) and let the LLM extract the answer. 0 credits. */
  async runFetchAttempt(st: RunState, cfg: AttemptConfig): Promise<[Attempt, TraceEvent[], FetchResponse | null]> {
    const attempt = makeAttempt({ attempt_no: cfg.attempt_no, rung: cfg.rung, config: cfg, started_at: nowIso() });
    const tr = new Trace(st.em, st.run.id, cfg.attempt_no);
    st.active = [attempt, tr];
    let fetchRaw: FetchResponse | null;

    if (cfg.from_fetch_cache && st.fetchRaw !== null) {
      fetchRaw = st.fetchRaw;
      const page = firstPage(fetchRaw);
      await tr.note("fetch_result", "Using cached Fetch text (0 credits)", {
        cached: true,
        final_url: page?.final_url ?? null,
        chars: (st.fetchText ?? "").length,
      });
    } else {
      try {
        fetchRaw = (await this.tinyfish.fetch(cfg.url)) as FetchResponse;
      } catch (e) {
        if (this.signal?.aborted) throw new UserCancelled("cancelled");
        const err =
          e instanceof TinyFishError
            ? e.asDict()
            : { code: "NETWORK", message: e instanceof Error ? e.message : String(e) };
        attempt.tf_status = "ERROR";
        attempt.tf_error = err;
        attempt.outcome = "error";
        await tr.note("fetch_error", `Fetch failed: ${String(err.code)}`, err, { source: "tinyfish_fetch" });
        attempt.finished_at = nowIso();
        return [attempt, tr.events, null];
      }
      st.fetchRaw = fetchRaw;
      const page = firstPage(fetchRaw);
      st.fetchText = page && typeof page.text === "string" ? page.text : null;
      if (page !== null) {
        const where = page.final_url || page.url || cfg.url;
        const title = page.title;
        const label = title ? `Fetched ${String(where)} (${String(title)})` : `Fetched ${String(where)}`;
        await tr.note("fetch_result", label, fetchRaw, { source: "tinyfish_fetch" });
      } else {
        const errors = fetchRaw.errors ?? [{}];
        const first = isPlainObject(errors[0]) ? errors[0] : {};
        const code = first.error;
        const status = first.status;
        await tr.note("fetch_error", `Fetch error: ${code === undefined ? "None" : String(code)}` + (status ? ` ${String(status)}` : ""), fetchRaw, {
          source: "tinyfish_fetch",
        });
      }
    }

    const page = firstPage(fetchRaw);
    attempt.tf_status = page !== null ? "OK" : "ERROR";
    if (page !== null && this.llm !== null) {
      const [result, extraction, err] = await extractFromFetch(this.llm, {
        goal: cfg.goal,
        outputSchema: cfg.output_schema,
        expected: st.run.request.expected,
        page,
        maxChars: this.settings.fetchTextMaxChars,
      });
      if (extraction !== null) st.extraction = extraction;
      let label: string;
      if (result !== null) label = `Extractor: found ${Object.keys(result).join(", ")}`;
      else if (err) label = `Extractor error: ${err}`;
      else {
        const missing = extraction ? extraction.missing.join(", ") : "";
        label = `Extractor: ${missing || "nothing"} not in the page text`;
      }
      const raw = extraction ? { ...extraction } : { error: err };
      await tr.note("extraction", label, raw, { source: "claude_extract" });
      attempt.result = result;
    }
    attempt.credits_estimated = 0;
    attempt.finished_at = nowIso();
    return [attempt, tr.events, fetchRaw];
  }

  // --- Run ------------------------------------------------------------------------------------

  /** Naive baseline: always stealth + proxy, run 3 times = 3 x steps of one run. */
  private baselineEstimate(run: Run): number {
    const agentSteps = run.attempts
      .filter((a) => a.rung !== "fetch" && a.num_of_steps !== null)
      .map((a) => a.num_of_steps as number);
    const steps = agentSteps.length ? Math.max(...agentSteps) : this.settings.baselineDefaultSteps;
    return 3 * steps;
  }

  private async verdict(st: RunState, status: RunStatus, reason: string, finalResult: JsonObject | null): Promise<void> {
    const run = st.run;
    run.status = status;
    run.finished_at = nowIso();
    run.verdict_reason = reason;
    run.final_result = finalResult;
    run.baseline_credits_estimate = this.baselineEstimate(run);
    await st.em.verdict(status, reason, {
      final_result: finalResult,
      attempts_used: run.attempts.length,
      credits_used: run.credits_used,
      baseline_credits_estimate: run.baseline_credits_estimate,
    });
  }

  /** Climb the ladder for one run. Never throws: a crash becomes an `error` verdict. */
  async execute(run: Run): Promise<Run> {
    const st: RunState = {
      run,
      em: new Emitter(run.id, this.sink),
      rung: run.request.start_rung,
      schema: run.request.output_schema,
      skipped: new Set(),
      prefixes: [],
      suffixes: [],
      fromFetchCache: false,
      fetchRaw: null,
      fetchText: null,
      extraction: null,
      reextractTried: false,
      history: [],
      historyRungs: [],
      patchesApplied: [],
      schemaEntitled: true,
      active: null,
    };
    try {
      await this.climb(st);
    } catch (e) {
      if (e instanceof UserCancelled || this.signal?.aborted) {
        await this.onUserCancel(st);
      } else {
        await this.verdict(st, "error", `Internal error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`, null);
      }
    }
    return run;
  }

  /** The caller aborted: stop the TinyFish run in flight, keep what it cost, say so. */
  private async onUserCancel(st: RunState): Promise<void> {
    const run = st.run;
    if (st.active !== null && !run.attempts.includes(st.active[0])) {
      const [attempt, tr] = st.active;
      if (attempt.tf_run_id) await this.safeCancel(attempt.tf_run_id);
      await tr.note("system", "Cancelled by user");
      attempt.outcome = "error";
      attempt.credits_estimated = attempt.progress_count;
      attempt.finished_at = nowIso();
      run.attempts.push(attempt);
      run.credits_used += attempt.credits_estimated;
    }
    await this.verdict(st, "cancelled", "Cancelled by user.", null);
  }

  private planContext(st: RunState, attempt: Attempt): PlanContext {
    return {
      rung: attempt.rung,
      request: st.run.request,
      from_fetch_cache: attempt.config.from_fetch_cache,
      current_schema: st.schema,
      skipped: new Set(st.skipped),
      history: [...st.history],
      history_rungs: [...st.historyRungs],
      fetch_text_available: Boolean(st.fetchText),
      fetch_extraction_found: Boolean(st.extraction && st.extraction.found),
      fetch_text: st.fetchText,
      reextract_tried: st.reextractTried,
      proxy_country: this.settings.proxyCountry,
      schema_entitled: st.schemaEntitled,
    };
  }

  private async climb(st: RunState): Promise<void> {
    const { run, em } = st;
    const settings = this.settings;
    run.status = "running";
    await em.budget(0, run.max_attempts, 0, run.max_credits);

    if (st.rung === "fetch" && this.llm === null) {
      st.rung = "agent";
      st.skipped.add("fetch");
      await em.rungChange(null, "agent", ["fetch"], "Rung 1 needs an LLM to extract the answer (no LLM key set) — starting at Rung 2.");
    } else {
      await em.rungChange(null, st.rung, [], `Start at ${RUNG_LABEL[st.rung]}.`);
    }

    for (let attemptNo = 1; attemptNo <= run.max_attempts; attemptNo++) {
      this.checkCancelled();
      if (st.rung !== "fetch") {
        const remaining = run.max_credits - run.credits_used;
        if (remaining < settings.agentMinCredits) {
          await this.verdict(
            st,
            "budget_exhausted",
            "Budget spent: not enough credits left for another agent attempt " +
              `(${remaining} left, ${settings.agentMinCredits} needed).`,
            null,
          );
          return;
        }
      }

      const cfg = this.buildConfig(st, attemptNo);
      await em.attemptStarted(cfg);
      let fetchUsed: FetchResponse | null = null;
      let attempt: Attempt;
      let trace: TraceEvent[];
      if (st.rung === "fetch") [attempt, trace, fetchUsed] = await this.runFetchAttempt(st, cfg);
      else [attempt, trace] = await this.runAgentAttempt(st, cfg);
      run.attempts.push(attempt);
      run.credits_used += attempt.credits_estimated;
      await em.budget(run.attempts.length, run.max_attempts, run.credits_used, run.max_credits);

      const tfError = attempt.tf_error ?? {};
      const code = String(tfError.code ?? "").toUpperCase();
      if (attempt.outcome === "error" && HARD_STOP_CODES.has(code)) {
        const message = String(tfError.message ?? "");
        if (code === "FORBIDDEN" && message.includes("output_schema") && cfg.output_schema) {
          st.schemaEntitled = false; // retry the same rung without a schema
          continue;
        }
        await this.verdict(st, "error", `TinyFish refused the request: ${code} — ${message}`, null);
        return;
      }

      const vr = verify(attempt, run.request, trace, fetchUsed);
      attempt.verify = vr;
      await em.verify(vr);
      if (vr.passed) {
        attempt.outcome = "verified";
        const fixed = st.history.map((d) => d.failure_class);
        let reason = `Verified on attempt ${attemptNo} (${RUNG_LABEL[attempt.rung]})`;
        if (fixed.length) reason += ` after fixing ${fixed.join(" → ")}`;
        await this.verdict(st, "verified", reason + ".", attempt.result);
        return;
      }
      if (attempt.outcome === "cancelled_budget") {
        await this.verdict(st, "budget_exhausted", "Budget spent: the attempt was cancelled at the credit limit.", null);
        return;
      }
      attempt.outcome = attempt.outcome ?? "rejected";

      const diagnosis = await diagnose({
        attempt,
        vr,
        trace,
        fetch: fetchUsed,
        fetchText: st.fetchText,
        extraction: attempt.rung === "fetch" ? st.extraction : null,
        history: [...st.history],
        planCtx: this.planContext(st, attempt),
        llm: this.llm,
        threshold: settings.rulesConfidenceThreshold,
        goal: run.request.goal,
        url: run.request.url,
      });
      attempt.diagnosis = diagnosis;
      await em.diagnosis(diagnosis);
      st.history.push(diagnosis);
      st.historyRungs.push(attempt.rung);

      const patch = diagnosis.patch;
      if (patch.stop || !diagnosis.recoverable) {
        await this.verdict(st, "unrecoverable", patch.stop_reason || explain(diagnosis.failure_class), null);
        return;
      }

      const previous = st.rung;
      st.rung = patch.next_rung ?? st.rung;
      for (const r of patch.skip_rungs) st.skipped.add(r);
      if (patch.goal_prefix && !st.prefixes.includes(patch.goal_prefix)) st.prefixes.push(patch.goal_prefix);
      if (patch.goal_suffix && !st.suffixes.includes(patch.goal_suffix)) st.suffixes.push(patch.goal_suffix);
      if (patch.output_schema !== null) st.schema = patch.output_schema;
      st.fromFetchCache = patch.reextract_from_fetch;
      st.reextractTried = st.reextractTried || patch.reextract_from_fetch;
      st.patchesApplied.push(...patch.summary);
      if (st.rung !== previous || patch.skip_rungs.length) {
        const headline = patch.summary.length ? patch.summary[0] : "next attempt";
        await em.rungChange(previous, st.rung, [...patch.skip_rungs], `${diagnosis.failure_class}: ${headline}`);
      }
    }

    await this.verdict(
      st,
      "budget_exhausted",
      `Budget spent: ${run.max_attempts}/${run.max_attempts} attempts used ` +
        `(${run.credits_used}/${run.max_credits} credits).`,
      null,
    );
  }
}
