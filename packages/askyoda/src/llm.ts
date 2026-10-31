/**
 * Optional LLM access for the Fetch-rung extractor and the diagnoser. Providers never throw:
 * every failure comes back as `{ parsed: null, error }` so callers fall back to the rules.
 * Plain `fetch`, no SDKs. Ports of apps/api/app/llm/{gemini,claude}.py.
 */

import type { FetchExtraction, LlmDiagnosis } from "./types.js";
import { isPlainObject } from "./util.js";

export interface ParseOutcome<T> {
  parsed: T | null;
  error: string | null;
  stopReason?: string | null;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  /** JSON Schema of the expected object. */
  schema: Record<string, unknown>;
  /** Name of the output (used as the Anthropic tool name). */
  name: string;
  /** Turns the provider's JSON into T, or throws. */
  validate: (value: unknown) => T;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Anything that can return a structured object for a prompt. Bring your own if you like. */
export interface LlmProvider {
  readonly model: string;
  parse<T>(req: StructuredRequest<T>): Promise<ParseOutcome<T>>;
}

export interface LlmOptions {
  provider: "gemini" | "anthropic";
  apiKey: string;
  model?: string;
  /** Override the API base URL (proxies, tests). */
  baseUrl?: string;
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 45_000;

export function createLlm(opts: LlmOptions | LlmProvider | null | undefined): LlmProvider | null {
  if (!opts) return null;
  if ("parse" in opts && typeof opts.parse === "function") return opts;
  const o = opts as LlmOptions;
  if (!o.apiKey) return null;
  return o.provider === "anthropic" ? new AnthropicProvider(o) : new GeminiProvider(o);
}

/** Busy (429) or overloaded (503/529) LLM APIs are often fine a moment later: retry once. */
async function withOneRetry(call: () => Promise<Response>, waitMs = 2000): Promise<Response> {
  const first = await call();
  if (![429, 503, 529].includes(first.status)) return first;
  await first.text().catch(() => "");
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return call();
}

function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

// --- Gemini (Google AI Studio, generateContent) ----------------------------------------------

const REFUSAL_REASONS = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

export class GeminiProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: Omit<LlmOptions, "provider">) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_GEMINI_MODEL;
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  async parse<T>(req: StructuredRequest<T>): Promise<ParseOutcome<T>> {
    const config: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (/^gemini-[34]/.test(this.model)) config.thinkingConfig = { thinkingLevel: "low" };
    let res: Response;
    try {
      res = await withOneRetry(() =>
        fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.user }] }],
            generationConfig: config,
          }),
          signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        }),
      );
    } catch (e) {
      return { parsed: null, error: errText(e) };
    }
    const bodyText = await res.text().catch(() => "");
    if (res.status === 429) return { parsed: null, error: `RateLimitError: ${bodyText.slice(0, 300)}` };
    if (!res.ok) return { parsed: null, error: `GeminiError ${res.status}: ${bodyText.slice(0, 300)}` };
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return { parsed: null, error: "Gemini returned non-JSON" };
    }
    const feedback = data.promptFeedback;
    if (isPlainObject(feedback) && feedback.blockReason) return { parsed: null, error: "refusal", stopReason: "refusal" };
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const first = candidates[0];
    if (!isPlainObject(first)) return { parsed: null, error: "no parsed output" };
    const finish = String(first.finishReason ?? "");
    if (REFUSAL_REASONS.has(finish)) return { parsed: null, error: "refusal", stopReason: "refusal" };
    const stopReason = finish === "MAX_TOKENS" ? "max_tokens" : "end_turn";
    const content = isPlainObject(first.content) ? first.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .filter((p): p is Record<string, unknown> => isPlainObject(p) && !p.thought)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
    if (!text) return { parsed: null, error: "no parsed output", stopReason };
    try {
      return { parsed: req.validate(JSON.parse(text)), error: null, stopReason };
    } catch (e) {
      return { parsed: null, error: `ValidationError: ${errText(e)}`, stopReason };
    }
  }
}

// --- Anthropic (Messages API, forced tool call for structured output) -------------------------

export class AnthropicProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: Omit<LlmOptions, "provider">) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async parse<T>(req: StructuredRequest<T>): Promise<ParseOutcome<T>> {
    let res: Response;
    try {
      res = await withOneRetry(() => fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          tools: [{ name: req.name, description: `Return the ${req.name} object.`, input_schema: req.schema }],
          tool_choice: { type: "tool", name: req.name },
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      }));
    } catch (e) {
      return { parsed: null, error: errText(e) };
    }
    const bodyText = await res.text().catch(() => "");
    if (res.status === 429) return { parsed: null, error: `RateLimitError: ${bodyText.slice(0, 300)}` };
    if (!res.ok) return { parsed: null, error: `AnthropicError ${res.status}: ${bodyText.slice(0, 300)}` };
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return { parsed: null, error: "Anthropic returned non-JSON" };
    }
    const stopReason = typeof data.stop_reason === "string" ? data.stop_reason : null;
    if (stopReason === "refusal") return { parsed: null, error: "refusal", stopReason };
    const blocks = Array.isArray(data.content) ? data.content : [];
    const tool = blocks.find((b) => isPlainObject(b) && b.type === "tool_use");
    if (!isPlainObject(tool)) return { parsed: null, error: "no parsed output", stopReason };
    try {
      return { parsed: req.validate(tool.input), error: null, stopReason };
    } catch (e) {
      return { parsed: null, error: `ValidationError: ${errText(e)}`, stopReason };
    }
  }
}

// --- Structured output models ----------------------------------------------------------------

const FAILURE_CLASSES = [
  "needs_interaction",
  "popup_overlay",
  "bot_block",
  "misread_page",
  "auth_wall",
  "captcha",
] as const;

export const FETCH_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    result_json: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
    interaction_hint: { type: "string" },
  },
  required: ["found", "result_json", "missing", "interaction_hint"],
};

export const LLM_DIAGNOSIS_SCHEMA = {
  type: "object",
  properties: {
    failure_class: { type: "string", enum: [...FAILURE_CLASSES] },
    confidence: { type: "number" },
    failing_step_seq: { type: ["integer", "null"] },
    evidence_quotes: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
    suggested_goal_prefix: { type: "string" },
    suggested_goal_suffix: { type: "string" },
  },
  required: [
    "failure_class",
    "confidence",
    "failing_step_seq",
    "evidence_quotes",
    "explanation",
    "suggested_goal_prefix",
    "suggested_goal_suffix",
  ],
};

function need(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function validateFetchExtraction(v: unknown): FetchExtraction {
  need(isPlainObject(v), "not an object");
  const o = v as Record<string, unknown>;
  need(typeof o.found === "boolean", "found must be a boolean");
  need(typeof o.result_json === "string", "result_json must be a string");
  need(Array.isArray(o.missing) && o.missing.every((m) => typeof m === "string"), "missing must be strings");
  need(typeof o.interaction_hint === "string", "interaction_hint must be a string");
  return {
    found: o.found as boolean,
    result_json: o.result_json as string,
    missing: o.missing as string[],
    interaction_hint: o.interaction_hint as string,
  };
}

export function validateLlmDiagnosis(v: unknown): LlmDiagnosis {
  need(isPlainObject(v), "not an object");
  const o = v as Record<string, unknown>;
  need((FAILURE_CLASSES as readonly string[]).includes(String(o.failure_class)), "unknown failure_class");
  need(typeof o.confidence === "number", "confidence must be a number");
  need(o.failing_step_seq === null || o.failing_step_seq === undefined || Number.isInteger(o.failing_step_seq), "bad failing_step_seq");
  need(Array.isArray(o.evidence_quotes), "evidence_quotes must be a list");
  need(typeof o.explanation === "string", "explanation must be a string");
  return {
    failure_class: o.failure_class as LlmDiagnosis["failure_class"],
    confidence: o.confidence as number,
    failing_step_seq: (o.failing_step_seq as number | null | undefined) ?? null,
    evidence_quotes: (o.evidence_quotes as unknown[]).map(String),
    explanation: o.explanation as string,
    suggested_goal_prefix: typeof o.suggested_goal_prefix === "string" ? o.suggested_goal_prefix : "",
    suggested_goal_suffix: typeof o.suggested_goal_suffix === "string" ? o.suggested_goal_suffix : "",
  };
}
