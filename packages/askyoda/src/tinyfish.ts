/**
 * TinyFish HTTP client and the pure helpers that map its payloads onto the data model.
 * Port of apps/api/app/tinyfish/client.py, on the global `fetch` (Node >= 18).
 *
 *   POST {fetchBase}                         Fetch (page -> markdown)
 *   POST {agentBase}/v1/automation/run-sse   Agent run as an SSE stream (each POST is a billed run)
 *   GET  {agentBase}/v1/runs/{id}            Run record incl. num_of_steps and steps[]
 *   POST {agentBase}/v1/runs/{id}/cancel     Idempotent cancel (run-sse runs only)
 */

import type { AttemptConfig, TinyFishErrorInfo, TraceEvent, TraceKind } from "./types.js";
import { defaultSleep, deepCopy, isPlainObject } from "./util.js";

export const USER_AGENT = "askyoda-js/0.1";
const FETCH_TIMEOUT_MS = 150_000;
const SSE_READ_GAP_MS = 90_000;
const RUNS_TIMEOUT_MS = 30_000;
const CANCEL_TIMEOUT_MS = 15_000;
const UI_STRING_LIMIT = 2000;

/** A request TinyFish rejected, or a response we could not use. */
export class TinyFishError extends Error {
  override readonly name = "TinyFishError";
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAfter: number | null = null,
    readonly requestId: string | null = null,
    readonly raw: Record<string, unknown> | null = null,
  ) {
    super(`${code}: ${message}`);
    this.detail = message;
  }
  readonly detail: string;

  asDict(): TinyFishErrorInfo {
    return {
      code: this.code,
      message: this.detail,
      http_status: this.httpStatus,
      retry_after: this.retryAfter,
      request_id: this.requestId,
    };
  }
}

/** TinyFish could not be reached at all (no response): our network, not the target site. */
export class TinyFishConnectError extends Error {
  override readonly name = "ConnectError";
}

/** The SSE stream broke after it started. */
export class TinyFishStreamError extends Error {
  override readonly name = "StreamError";
}

function retryAfterOf(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function errorFromResponse(res: Response, content: string): TinyFishError {
  let raw: unknown = null;
  try {
    raw = JSON.parse(content);
  } catch {
    /* not JSON */
  }
  const err = isPlainObject(raw) ? raw.error : null;
  const code = isPlainObject(err) && typeof err.code === "string" ? err.code : null;
  let message = isPlainObject(err) && typeof err.message === "string" ? err.message : null;
  if (!message) message = content.trim().slice(0, 300) || res.statusText || `HTTP ${res.status}`;
  const requestId = isPlainObject(raw) && typeof raw.request_id === "string" ? raw.request_id : null;
  return new TinyFishError(
    (code || `HTTP_${res.status}`).toUpperCase(),
    message,
    res.status,
    retryAfterOf(res),
    requestId || res.headers.get("x-request-id"),
    isPlainObject(raw) ? raw : null,
  );
}

/** The calls the ladder needs; implement it to plug in a fake or a proxy. */
export interface TinyFishApi {
  fetch(url: string): Promise<Record<string, unknown>>;
  agentStream(body: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<Record<string, unknown>>;
  getRun(tfRunId: string, screenshots?: string): Promise<Record<string, unknown>>;
  cancel(tfRunId: string): Promise<Record<string, unknown>>;
}

export interface TinyFishClientOptions {
  agentBase?: string;
  fetchBase?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class TinyFishClient implements TinyFishApi {
  readonly agentBase: string;
  readonly fetchBase: string;
  private readonly headers: Record<string, string>;
  private readonly http: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(apiKey: string, opts: TinyFishClientOptions = {}) {
    this.agentBase = (opts.agentBase ?? "https://agent.tinyfish.ai").replace(/\/+$/, "");
    this.fetchBase = (opts.fetchBase ?? "https://api.fetch.tinyfish.ai").replace(/\/+$/, "");
    this.headers = { "X-API-Key": apiKey, "User-Agent": USER_AGENT };
    this.http = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.http(url, { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string>) } });
    } catch (e) {
      if (init.signal?.aborted && (init.signal.reason as Error)?.name !== "TimeoutError") throw e;
      throw new TinyFishConnectError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Fetch one URL as markdown. Per-URL failures come back in `errors[]` with HTTP 200. */
  async fetch(url: string): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ urls: [url], format: "markdown" });
    for (const attempt of [1, 2]) {
      const res = await this.request(this.fetchBase, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if ((res.status === 429 || res.status === 503) && attempt === 1) {
        await res.text().catch(() => "");
        await this.sleep(Math.min(retryAfterOf(res) ?? 2, 5) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw errorFromResponse(res, text);
      return JSON.parse(text) as Record<string, unknown>;
    }
    throw new Error("unreachable");
  }

  /**
   * Start an agent run and yield each SSE `data:` payload. Never retries: every POST creates a
   * billed run. Non-2xx throws before anything is yielded.
   */
  async *agentStream(body: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    const res = await this.request(`${this.agentBase}/v1/automation/run-sse`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw errorFromResponse(res, await res.text().catch(() => ""));
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const gap = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TinyFishStreamError("no data for 90s")), SSE_READ_GAP_MS);
        });
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), gap]);
        } catch (e) {
          if (signal?.aborted) throw e;
          throw e instanceof TinyFishStreamError ? e : new TinyFishStreamError(e instanceof Error ? e.message : String(e));
        } finally {
          clearTimeout(timer);
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          const parsed = parseSseLine(line);
          if (parsed) yield parsed;
        }
      }
      const tail = parseSseLine(buffer.replace(/\r$/, ""));
      if (tail) yield tail;
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async getRun(tfRunId: string, screenshots = "none"): Promise<Record<string, unknown>> {
    const res = await this.request(
      `${this.agentBase}/v1/runs/${encodeURIComponent(tfRunId)}?screenshots=${encodeURIComponent(screenshots)}`,
      { method: "GET", signal: AbortSignal.timeout(RUNS_TIMEOUT_MS) },
    );
    const text = await res.text();
    if (!res.ok) throw errorFromResponse(res, text);
    return JSON.parse(text) as Record<string, unknown>;
  }

  async cancel(tfRunId: string): Promise<Record<string, unknown>> {
    const res = await this.request(`${this.agentBase}/v1/runs/${encodeURIComponent(tfRunId)}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw errorFromResponse(res, text);
    return JSON.parse(text) as Record<string, unknown>;
  }

  async stepScreenshot(tfRunId: string, stepId: string): Promise<Uint8Array> {
    const res = await this.request(
      `${this.agentBase}/v1/runs/${encodeURIComponent(tfRunId)}/steps/${encodeURIComponent(stepId)}/screenshot`,
      { method: "GET", signal: AbortSignal.timeout(RUNS_TIMEOUT_MS) },
    );
    if (!res.ok) throw errorFromResponse(res, await res.text().catch(() => ""));
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** One SSE line -> payload, or null for blank/comment/`event:`/`id:` lines. */
export function parseSseLine(line: string): Record<string, unknown> | null {
  if (!line || line.startsWith(":") || !line.startsWith("data:")) return null;
  try {
    const payload: unknown = JSON.parse(line.slice(5).trim());
    return isPlainObject(payload) ? payload : { type: "_UNPARSEABLE", line };
  } catch {
    return { type: "_UNPARSEABLE", line };
  }
}

/**
 * The exact run-sse body. Never sends beta- or account-gated fields (max_steps, mode,
 * capture_config) or `proxy_config.type`, which the run-sse schema doesn't allow.
 */
export function buildAgentBody(cfg: AttemptConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: cfg.url,
    goal: cfg.goal,
    browser_profile: cfg.browser_profile,
    agent_config: { max_duration_seconds: cfg.max_duration_seconds },
  };
  if (cfg.output_schema !== null) body.output_schema = cfg.output_schema;
  if (cfg.proxy_enabled) body.proxy_config = { enabled: true, country_code: cfg.proxy_country || "US" };
  return body;
}

// --- Pure mapping helpers --------------------------------------------------------------------

const SSE_KINDS: Record<string, TraceKind> = {
  STARTED: "started",
  STREAMING_URL: "live_view",
  PROGRESS: "progress",
  HEARTBEAT: "heartbeat",
  COMPLETE: "complete",
  TF_API_RESULT: "tf_api_result",
};

function sseLabel(raw: Record<string, unknown>, kind: TraceKind): string {
  switch (kind) {
    case "started":
      return "Agent started";
    case "live_view":
      return "Live view ready";
    case "progress": {
      const purpose = raw.purpose;
      return typeof purpose === "string" && purpose.trim() ? purpose.trim() : "(no purpose)";
    }
    case "heartbeat":
      return "heartbeat";
    case "complete":
      return `Agent finished: ${raw.status === undefined ? "None" : String(raw.status)}`;
    case "tf_api_result":
      return `Agent used TinyFish ${raw.tinyfish_api === undefined ? "None" : String(raw.tinyfish_api)}`;
    default:
      break;
  }
  if (raw.type === "_UNPARSEABLE") return "Unparseable stream line";
  return `Unknown event ${raw.type === undefined ? "None" : String(raw.type)}`;
}

/** Map one run-sse payload onto a TraceEvent, keeping the payload verbatim in `raw`. */
export function mapSseEvent(
  raw: Record<string, unknown>,
  opts: { runId: string; attemptNo: number; seq: number; stepNo: number | null; now: string },
): TraceEvent {
  const kind = SSE_KINDS[String(raw.type)] ?? "unknown";
  return {
    run_id: opts.runId,
    attempt_no: opts.attemptNo,
    seq: opts.seq,
    kind,
    source: "tinyfish_sse",
    ts: opts.now,
    tf_timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
    tf_run_id: typeof raw.run_id === "string" ? raw.run_id : null,
    step_no: kind === "progress" ? opts.stepNo : null,
    label: sseLabel(raw, kind),
    raw,
  };
}

/**
 * Normalize the error on a COMPLETE event or a run object. TinyFish sends `error` both as a
 * string and as an object {code, message, category, retry_after, ...}; codes may be lowercase.
 */
export function normalizeTfError(obj: Record<string, unknown>): TinyFishErrorInfo | null {
  const error = obj.error;
  let hint: Record<string, unknown> | null = isPlainObject(obj.profile_hint) ? obj.profile_hint : null;
  const out: Record<string, unknown> = {
    code: null,
    message: null,
    category: null,
    retry_after: null,
    help_url: obj.help_url ?? null,
    help_message: obj.help_message ?? null,
    profile_hint_reason: null,
  };
  if (typeof error === "string" && error.trim()) {
    out.message = error.trim();
  } else if (isPlainObject(error)) {
    const code = error.code;
    out.code = typeof code === "string" && code ? code.toUpperCase() : null;
    out.message = error.message ?? null;
    out.category = error.category ?? null;
    out.retry_after = error.retry_after ?? null;
    out.help_url = error.help_url || out.help_url;
    out.help_message = error.help_message || out.help_message;
    if (hint === null && isPlainObject(error.profile_hint)) hint = error.profile_hint;
  }
  if (hint !== null) out.profile_hint_reason = hint.reason ?? null;
  if (out.message === null && out.code === null && out.profile_hint_reason === null) return null;
  return out as TinyFishErrorInfo;
}

function truncate(value: unknown): unknown {
  if (typeof value === "string" && value.length > UI_STRING_LIMIT) {
    return value.slice(0, UI_STRING_LIMIT) + `…[truncated ${value.length - UI_STRING_LIMIT} chars]`;
  }
  if (Array.isArray(value)) return value.map(truncate);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  return value;
}

/** Copy for event listeners: long strings in `raw` (e.g. Fetch page text) are cut to 2,000 chars. */
export function uiCopy(ev: TraceEvent): TraceEvent {
  return { ...ev, raw: truncate(deepCopy(ev.raw)) as Record<string, unknown> };
}
