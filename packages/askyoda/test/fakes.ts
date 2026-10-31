/** Scripted stand-ins for TinyFish and the LLM (tests never touch the network). */

import type { LlmProvider, ParseOutcome, StructuredRequest } from "../src/llm.js";
import type { TinyFishApi } from "../src/tinyfish.js";
import type {
  Attempt,
  AttemptConfig,
  FetchExtraction,
  LlmDiagnosis,
  Rung,
  TraceEvent,
  TraceKind,
} from "../src/types.js";
import { makeAttempt, makeConfig } from "../src/types.js";

export const T0 = "2026-11-01T11:00:00.000Z";

type Script = Record<string, unknown>[] | Error;

export class FakeTinyFish implements TinyFishApi {
  fetchScript: (Record<string, unknown> | Error)[];
  streamScript: Script[];
  runs: Record<string, Record<string, unknown>>;
  polls: Record<string, Record<string, unknown>[]>;
  bodies: Record<string, unknown>[] = [];
  fetched: string[] = [];
  cancelled: string[] = [];

  constructor(opts: {
    fetch?: (Record<string, unknown> | Error)[];
    streams?: Script[];
    runs?: Record<string, Record<string, unknown>>;
    polls?: Record<string, Record<string, unknown>[]>;
  } = {}) {
    this.fetchScript = [...(opts.fetch ?? [])];
    this.streamScript = [...(opts.streams ?? [])];
    this.runs = opts.runs ?? {};
    this.polls = opts.polls ?? {};
  }

  async fetch(url: string) {
    this.fetched.push(url);
    const item = this.fetchScript.shift();
    if (item instanceof Error) throw item;
    return item as Record<string, unknown>;
  }

  async *agentStream(body: Record<string, unknown>) {
    this.bodies.push(body);
    const script = this.streamScript.shift();
    if (script instanceof Error) throw script;
    for (const event of script ?? []) yield event;
  }

  async getRun(tfRunId: string) {
    const queue = this.polls[tfRunId];
    if (queue && queue.length) return queue.shift()!;
    return this.runs[tfRunId] ?? { run_id: tfRunId, status: "COMPLETED" };
  }

  async cancel(tfRunId: string) {
    this.cancelled.push(tfRunId);
    return { run_id: tfRunId, status: "CANCELLED" };
  }
}

type Scripted = FetchExtraction | LlmDiagnosis | ParseOutcome<unknown>;

/** Returns scripted outputs per output name ("fetch_extraction" | "diagnosis"), in order. */
export class FakeLlm implements LlmProvider {
  readonly model = "fake";
  responses: Record<string, Scripted[]>;
  calls: { name: string; system: string; user: string }[] = [];

  constructor(responses: Record<string, Scripted[]> = {}) {
    this.responses = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  }

  async parse<T>(req: StructuredRequest<T>): Promise<ParseOutcome<T>> {
    this.calls.push({ name: req.name, system: req.system, user: req.user });
    const item = (this.responses[req.name] ?? []).shift();
    if (item === undefined) return { parsed: null, error: "no scripted response" };
    if ("parsed" in item && "error" in item) return item as ParseOutcome<T>;
    return { parsed: req.validate(item), error: null, stopReason: "end_turn" };
  }

  callsFor(name: string) {
    return this.calls.filter((c) => c.name === name);
  }
}

export function sseRun(
  tfRunId: string,
  purposes: string[],
  opts: { status?: string; result?: Record<string, unknown> | null } = {},
): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [
    { type: "STARTED", run_id: tfRunId, timestamp: "2026-11-01T11:00:04Z" },
    {
      type: "STREAMING_URL",
      run_id: tfRunId,
      streaming_url: `https://${tfRunId.replace(/_/g, "-")}.invalid/stream/0`,
      timestamp: "2026-11-01T11:00:06Z",
    },
  ];
  for (const p of purposes) events.push({ type: "PROGRESS", run_id: tfRunId, purpose: p });
  events.push({ type: "COMPLETE", run_id: tfRunId, status: opts.status ?? "COMPLETED", result: opts.result ?? null });
  return events;
}

export function runRecord(tfRunId: string, steps: number, opts: { proxy?: boolean } = {}): Record<string, unknown> {
  return {
    run_id: tfRunId,
    status: "COMPLETED",
    num_of_steps: steps,
    browser_config: { proxy_enabled: !!opts.proxy, proxy_country_code: opts.proxy ? "US" : null },
    steps: Array.from({ length: steps }, (_, i) => ({
      id: `${tfRunId}-s${i + 1}`,
      timestamp: `2026-11-01T11:00:${String(11 + i).padStart(2, "0")}Z`,
      action: `step ${i + 1}`,
    })),
  };
}

export const SAMPLE_PAGE = {
  url: "https://shop.example.com/products",
  final_url: "https://shop.example.com/products",
  title: "Acme Shop — Products",
  description: null,
  language: "en",
  text: "# Products\n\nWe use cookies to improve your experience. [Accept all] [Manage]\n\nLoading products…",
  latency_ms: 1840,
  format: "markdown",
};
export const SAMPLE_FETCH = { results: [SAMPLE_PAGE], errors: [] };

export function cfg(rung: Rung, overrides: Partial<AttemptConfig> = {}): AttemptConfig {
  return makeConfig({
    attempt_no: 1,
    rung,
    url: "https://x.example",
    goal: "g",
    max_duration_seconds: 150,
    credit_limit: rung === "fetch" ? 0 : 40,
    ...overrides,
  });
}

export function attemptOf(rung: Rung, fields: Partial<Attempt> = {}, config: Partial<AttemptConfig> = {}): Attempt {
  const c = cfg(rung, { attempt_no: fields.attempt_no ?? 1, ...config });
  return makeAttempt({ attempt_no: c.attempt_no, rung, config: c, started_at: T0, ...fields });
}

export function ev(
  seq: number,
  kind: TraceKind,
  label = "",
  opts: { stepNo?: number | null; attemptNo?: number; raw?: Record<string, unknown> } = {},
): TraceEvent {
  return {
    run_id: "r",
    attempt_no: opts.attemptNo ?? 1,
    seq,
    kind,
    source: "tinyfish_sse",
    ts: T0,
    tf_timestamp: null,
    tf_run_id: null,
    step_no: opts.stepNo ?? null,
    label: label || kind,
    raw: opts.raw ?? {},
  };
}
