/** The public entry point: `new AskYoda({ tinyfishKey }).run({ url, goal, expect })`. */

import { LadderController, type LadderSettings } from "./controller.js";
import { createLlm, type LlmOptions, type LlmProvider } from "./llm.js";
import { tinyfishSchemaErrors } from "./schema.js";
import { TinyFishClient, type TinyFishApi } from "./tinyfish.js";
import type {
  AskYodaEvent,
  Attempt,
  Diagnosis,
  ExpectedCheck,
  JsonObject,
  Run,
  Rung,
} from "./types.js";
import { makeExpected } from "./types.js";

/** What counts as a right answer. Give exactly one. */
export type Expectation =
  | { contains: string }
  | { regex: string | RegExp }
  | { fieldsPresent: string[] }
  | { minItems: { path: string; min: number } };

export interface AskYodaOptions {
  /** Your TinyFish API key (https://agent.tinyfish.ai/api-keys). Runs bill to your account. */
  tinyfishKey?: string;
  /** Optional LLM for Rung 1 extraction and for diagnosing failures the rules are unsure about. */
  llm?: LlmOptions | LlmProvider | null;
  /** Proxy exit country for Rung 3 (ISO 3166-1 alpha-2). Default "US". */
  proxyCountry?: string;
  /** Advanced: ladder tuning. */
  settings?: Partial<Omit<LadderSettings, "proxyCountry">>;
  /** Advanced: your own TinyFish client (proxies, tests). */
  tinyfish?: TinyFishApi;
  agentBase?: string;
  fetchBase?: string;
}

export interface RunInput {
  url: string;
  goal: string;
  expect?: Expectation;
  /** TinyFish output_schema subset (top-level object). */
  outputSchema?: JsonObject;
  /** Rung to start on. Default "fetch" (free); skipped automatically without an LLM. */
  startRung?: Rung;
  /** Hard cap on attempts (1-8). Default 4. */
  maxAttempts?: number;
  /** Hard cap on estimated TinyFish credits (1 per agent step, 0-500). Default 40. */
  maxCredits?: number;
  signal?: AbortSignal;
  onEvent?: (event: AskYodaEvent) => void | Promise<void>;
}

/** `needs_human` = the run stopped honestly (login wall, CAPTCHA, still blocked): escalate to a person. */
export type RunOutcome = "verified" | "needs_human" | "budget_exhausted" | "error" | "cancelled";

export interface RunResult {
  id: string;
  status: RunOutcome;
  ok: boolean;
  /** One plain sentence: why the run ended this way. */
  reason: string;
  /** The verified answer (only when status is "verified"). */
  result: JsonObject | null;
  attempts: Attempt[];
  diagnoses: Diagnosis[];
  attemptsUsed: number;
  creditsUsed: number;
  maxAttempts: number;
  maxCredits: number;
  /** Credits a naive "always stealth + proxy, run 3 times" approach would have used (estimate). */
  baselineCreditsEstimate: number | null;
  /** The full run record (same JSON shape as the AskYoda web API). */
  run: Run;
}

export class AskYodaInputError extends Error {
  override readonly name = "AskYodaInputError";
}

function randomId(): string {
  let id = "";
  for (let i = 0; i < 12; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

export function toExpectedCheck(expect: Expectation | undefined): ExpectedCheck | null {
  if (!expect) return null;
  const keys = Object.keys(expect);
  if (keys.length !== 1) throw new AskYodaInputError("expect must have exactly one of contains, regex, fieldsPresent, minItems");
  if ("contains" in expect) {
    if (!expect.contains) throw new AskYodaInputError("expect.contains must be a non-empty string");
    return makeExpected({ type: "contains", value: expect.contains });
  }
  if ("regex" in expect) {
    const source = expect.regex instanceof RegExp ? expect.regex.source : expect.regex;
    if (!source) throw new AskYodaInputError("expect.regex must be a non-empty pattern");
    try {
      new RegExp(source, "i");
    } catch (e) {
      throw new AskYodaInputError(`expect.regex is not a valid regex: ${(e as Error).message}`);
    }
    return makeExpected({ type: "regex", value: source });
  }
  if ("fieldsPresent" in expect) {
    const fields = expect.fieldsPresent;
    if (!Array.isArray(fields) || !fields.length || !fields.every((f) => typeof f === "string" && f.trim())) {
      throw new AskYodaInputError("expect.fieldsPresent must list at least one non-empty path");
    }
    return makeExpected({ type: "fields_present", fields });
  }
  if ("minItems" in expect) {
    const { path, min } = expect.minItems ?? ({} as { path: string; min: number });
    if (!path) throw new AskYodaInputError("expect.minItems.path is required");
    if (!Number.isInteger(min) || min < 1) throw new AskYodaInputError("expect.minItems.min must be an integer >= 1");
    return makeExpected({ type: "min_items", path, min });
  }
  throw new AskYodaInputError("expect must have one of contains, regex, fieldsPresent, minItems");
}

function toOutcome(status: Run["status"]): RunOutcome {
  if (status === "unrecoverable") return "needs_human";
  if (status === "verified" || status === "budget_exhausted" || status === "cancelled") return status;
  return "error";
}

export class AskYoda {
  private readonly tinyfish: TinyFishApi;
  private readonly llm: LlmProvider | null;
  private readonly settings: Partial<LadderSettings>;

  constructor(opts: AskYodaOptions = {}) {
    if (opts.tinyfish) this.tinyfish = opts.tinyfish;
    else {
      if (!opts.tinyfishKey) throw new AskYodaInputError("tinyfishKey is required (get one at https://agent.tinyfish.ai/api-keys)");
      this.tinyfish = new TinyFishClient(opts.tinyfishKey, { agentBase: opts.agentBase, fetchBase: opts.fetchBase });
    }
    this.llm = createLlm(opts.llm ?? null);
    this.settings = { ...(opts.settings ?? {}), proxyCountry: opts.proxyCountry ?? "US" };
  }

  /** Whether an LLM is configured (Rung 1 and LLM diagnosis need one). */
  get hasLlm(): boolean {
    return this.llm !== null;
  }

  private buildRun(input: RunInput): Run {
    const url = (input.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new AskYodaInputError("url must start with http:// or https://");
    const goal = (input.goal ?? "").trim();
    if (!goal || goal.length > 2000) throw new AskYodaInputError("goal must be 1-2000 characters");
    const maxAttempts = input.maxAttempts ?? 4;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
      throw new AskYodaInputError("maxAttempts must be an integer from 1 to 8");
    }
    const maxCredits = input.maxCredits ?? 40;
    if (!Number.isInteger(maxCredits) || maxCredits < 0 || maxCredits > 500) {
      throw new AskYodaInputError("maxCredits must be an integer from 0 to 500");
    }
    const outputSchema = input.outputSchema ?? null;
    if (outputSchema !== null) {
      const errors = tinyfishSchemaErrors(outputSchema);
      if (errors.length) throw new AskYodaInputError("outputSchema: " + errors.join("; "));
    }
    const startRung = input.startRung ?? "fetch";
    if (!["fetch", "agent", "agent_stealth"].includes(startRung)) {
      throw new AskYodaInputError("startRung must be fetch, agent or agent_stealth");
    }
    return {
      id: randomId(),
      created_at: new Date().toISOString(),
      finished_at: null,
      request: { url, goal, expected: toExpectedCheck(input.expect), output_schema: outputSchema, start_rung: startRung },
      status: "queued",
      attempts: [],
      credits_used: 0,
      max_attempts: maxAttempts,
      max_credits: maxCredits,
      final_result: null,
      verdict_reason: null,
      baseline_credits_estimate: null,
    };
  }

  /** Run the ladder to a verdict. Never throws for run failures (only for invalid input). */
  async run(input: RunInput): Promise<RunResult> {
    const run = this.buildRun(input);
    const controller = new LadderController({
      tinyfish: this.tinyfish,
      llm: this.llm,
      settings: this.settings,
      onEvent: input.onEvent,
      signal: input.signal,
    });
    await controller.execute(run);
    return summarize(run);
  }

  /**
   * The same run as an async iterator of events; the generator's return value is the RunResult.
   *
   *   for await (const ev of yoda.stream({ url, goal })) console.log(ev.type)
   */
  async *stream(input: Omit<RunInput, "onEvent">): AsyncGenerator<AskYodaEvent, RunResult> {
    const queue: AskYodaEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const pending = this.run({
      ...input,
      onEvent: (ev) => {
        queue.push(ev);
        wake?.();
      },
    }).finally(() => {
      done = true;
      wake?.();
    });
    for (;;) {
      while (queue.length) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
    return pending;
  }
}

export function summarize(run: Run): RunResult {
  const status = toOutcome(run.status);
  return {
    id: run.id,
    status,
    ok: status === "verified",
    reason: status === "needs_human" ? `Needs human escalation: ${run.verdict_reason ?? ""}`.trim() : (run.verdict_reason ?? ""),
    result: run.final_result,
    attempts: run.attempts,
    diagnoses: run.attempts.map((a) => a.diagnosis).filter((d): d is Diagnosis => d !== null),
    attemptsUsed: run.attempts.length,
    creditsUsed: run.credits_used,
    maxAttempts: run.max_attempts,
    maxCredits: run.max_credits,
    baselineCreditsEstimate: run.baseline_credits_estimate,
    run,
  };
}
