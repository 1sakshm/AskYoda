/**
 * Patch planner: turns a diagnosis into the next attempt's changes. Port of
 * apps/api/app/patch/planner.py.
 *
 * Per class: captcha and auth walls stop (human escalation); bot blocks escalate to stealth +
 * proxy (skipping the plain agent when Fetch already saw the wall); popups get a goal prefix that
 * dismisses dialogs; pages that need interaction escalate from Fetch or get an interaction suffix;
 * misreads are first re-extracted from the cached Fetch text for free, otherwise retried with a
 * tighter schema and a "copy values exactly" suffix. A class that already failed once on a rung
 * escalates instead.
 */

import { tinyfishSchemaErrors } from "./schema.js";
import type { Diagnosis, ExpectedCheck, FailureClass, JsonObject, Patch, Rung, RunRequest } from "./types.js";
import { RUNG_LABEL, RUNG_ORDER, makePatch } from "./types.js";
import { deepCopy, isPlainObject } from "./util.js";

export const GOAL_MAX_CHARS = 2000;
const LLM_TEXT_MAX_CHARS = 300;

export const POPUP_PREFIX =
  "Before doing anything else, close any cookie consent banner, newsletter popup or modal " +
  "dialog (click 'Accept', 'Accept all', 'Close', 'X' or 'No thanks') and wait until it has " +
  "disappeared.";
export const INTERACT_SUFFIX =
  "If the requested data is not visible yet, interact with the page to reveal it: use the " +
  "search box, filters, tabs, 'Load more' or 'Next' buttons as needed.";
export const MISREAD_SUFFIX =
  "Return only a JSON object that matches the output schema. Copy every value exactly as shown " +
  "on the visible page; do not guess, and do not return null for required fields.";
export const STOP_CAPTCHA =
  "CAPTCHA detected — TinyFish cannot solve CAPTCHAs, so another attempt would only burn credits.";
export const STOP_AUTH =
  "Login wall — this content needs an account, and logins are out of scope for this tool.";

const SUMMARY_POPUP = "Goal prefix: close cookie/consent dialogs before anything else";
const SUMMARY_INTERACT = "Goal suffix: interact with search/filters/'Load more' to reveal the data";
const SUMMARY_REEXTRACT = "Re-extract from the cached Fetch text with a tighter schema (0 credits)";
const SUMMARY_SCHEMA = "Tighter output schema";
const SUMMARY_COPY_EXACT = "Goal suffix: copy values exactly from the page";

export interface PlanContext {
  rung: Rung;
  request: Pick<RunRequest, "expected">;
  from_fetch_cache?: boolean;
  current_schema?: JsonObject | null;
  skipped?: Set<Rung>;
  history?: Diagnosis[];
  history_rungs?: Rung[];
  fetch_text_available?: boolean;
  fetch_extraction_found?: boolean;
  fetch_text?: string | null;
  reextract_tried?: boolean;
  proxy_country?: string;
  schema_entitled?: boolean;
}

type Ctx = Required<PlanContext>;

function withDefaults(ctx: PlanContext): Ctx {
  return {
    rung: ctx.rung,
    request: ctx.request,
    from_fetch_cache: ctx.from_fetch_cache ?? false,
    current_schema: ctx.current_schema ?? null,
    skipped: ctx.skipped ?? new Set(),
    history: ctx.history ?? [],
    history_rungs: ctx.history_rungs ?? [],
    fetch_text_available: ctx.fetch_text_available ?? false,
    fetch_extraction_found: ctx.fetch_extraction_found ?? false,
    fetch_text: ctx.fetch_text ?? null,
    reextract_tried: ctx.reextract_tried ?? false,
    proxy_country: ctx.proxy_country ?? "US",
    schema_entitled: ctx.schema_entitled ?? true,
  };
}

// --- Goal and rung helpers --------------------------------------------------------------------

/**
 * Prefixes, then the user's goal, then suffixes; duplicates dropped, oldest suffixes first to go
 * if the goal would exceed TinyFish-friendly length.
 */
export function composeGoal(original: string, prefixes: string[], suffixes: string[]): string {
  const pre = [...new Set(prefixes.filter((p) => p))];
  const suf = [...new Set(suffixes.filter((s) => s && !pre.includes(s)))];
  let goal = [...pre, original, ...suf].join("\n\n");
  while (goal.length > GOAL_MAX_CHARS && suf.length) {
    suf.shift();
    goal = [...pre, original, ...suf].join("\n\n");
  }
  return goal;
}

export function nextRungUp(rung: Rung, skipped: Set<Rung>): Rung | null {
  const later = RUNG_ORDER.slice(RUNG_ORDER.indexOf(rung) + 1);
  return later.find((r) => !skipped.has(r)) ?? null;
}

function usableLlmText(text: string): string {
  const t = (text || "").trim();
  return t.length > 0 && t.length <= LLM_TEXT_MAX_CHARS ? t : "";
}

// --- Schema derivation ------------------------------------------------------------------------

function tighten(node: unknown): void {
  if (!isPlainObject(node)) return;
  const props = node.properties;
  if (isPlainObject(props)) {
    node.required = Object.keys(props);
    for (const sub of Object.values(props)) tighten(sub);
  }
  if (node.type === "array") {
    if (!("minItems" in node)) node.minItems = 1;
    tighten(node.items);
  }
  for (const branch of Array.isArray(node.anyOf) ? node.anyOf : []) tighten(branch);
}

function schemaForPaths(paths: string[][]): JsonObject {
  const groups = new Map<string, string[][]>();
  for (const segments of paths) {
    if (!groups.has(segments[0])) groups.set(segments[0], []);
    groups.get(segments[0])!.push(segments.slice(1));
  }
  const properties: JsonObject = {};
  for (const [key, rests] of groups) {
    const nested = rests.filter((r) => r.length);
    if (!nested.length) {
      properties[key] = { type: "string" };
    } else if (nested.every((r) => /^\d+$/.test(r[0]))) {
      const inner = nested.map((r) => r.slice(1)).filter((r) => r.length);
      const items = inner.length ? schemaForPaths(inner) : { type: "string" };
      const minItems = Math.max(...nested.map((r) => Number(r[0]))) + 1;
      properties[key] = { type: "array", items, minItems };
    } else {
      properties[key] = schemaForPaths(nested);
    }
  }
  return { type: "object", properties, required: Object.keys(properties) };
}

/**
 * A stricter TinyFish output_schema: tighten the existing one, or build one from the expected
 * check. Never returns a schema TinyFish would reject.
 */
export function deriveSchema(expected: ExpectedCheck | null, existing: JsonObject | null): JsonObject | null {
  let schema: JsonObject | null = null;
  if (existing && Object.keys(existing).length) {
    schema = deepCopy(existing);
    tighten(schema);
  } else if (expected && expected.type === "fields_present") {
    const paths = (expected.fields ?? []).map((f) => f.split(".").filter((s) => s)).filter((p) => p.length);
    schema = paths.length ? schemaForPaths(paths) : null;
  } else if (expected && (expected.type === "contains" || expected.type === "regex")) {
    schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  }
  if (schema !== null && tinyfishSchemaErrors(schema).length) return null;
  return schema;
}

// --- Planning ---------------------------------------------------------------------------------

function escalate(rung: Rung, ctx: Ctx, reason?: string): Patch {
  const target = nextRungUp(rung, ctx.skipped);
  if (target === null) {
    return makePatch({
      stop: true,
      stop_reason: reason || "No higher rung left to try — stopping instead of burning credits.",
      summary: ["Stop: no higher rung left"],
    });
  }
  return makePatch({ next_rung: target, summary: [`Escalate to ${RUNG_LABEL[target]}`] });
}

/**
 * The class already failed on this rung, so its patch was tried there. Cache re-extracts are
 * never repeats: they are a different, free path.
 */
function isRepeat(failureClass: FailureClass, ctx: Ctx): boolean {
  if (ctx.from_fetch_cache) return false;
  const n = Math.min(ctx.history.length, ctx.history_rungs.length);
  for (let i = 0; i < n; i++) {
    if (ctx.history[i].failure_class === failureClass && ctx.history_rungs[i] === ctx.rung) return true;
  }
  return false;
}

function expectedMatchesText(expected: ExpectedCheck | null, text: string | null): boolean {
  if (!expected || !text) return false;
  if (expected.type === "contains") return !!expected.value && text.toLowerCase().includes(expected.value.toLowerCase());
  if (expected.type === "regex") return !!expected.value && new RegExp(expected.value, "i").test(text);
  return false;
}

function misreadTightening(ctx: Ctx, llmSuffix: string): [JsonObject | null, string, string[]] {
  const schema = ctx.schema_entitled ? deriveSchema(ctx.request.expected, ctx.current_schema) : null;
  let suffix = MISREAD_SUFFIX;
  const expected = ctx.request.expected;
  if (expected && expected.type === "min_items") {
    suffix += ` Return at least ${expected.min} items in '${expected.path}'.`;
  }
  const llm = usableLlmText(llmSuffix);
  if (llm) suffix += " " + llm;
  const summary = [...(schema ? [SUMMARY_SCHEMA] : []), SUMMARY_COPY_EXACT];
  return [schema, suffix, summary];
}

function planMisread(ctx: Ctx, llmSuffix: string): Patch {
  const [schema, suffix, summary] = misreadTightening(ctx, llmSuffix);

  if (ctx.rung === "fetch" && ctx.from_fetch_cache) {
    // (b) the free re-extract failed too: back to the agent rung we came from.
    const agentRungs = ctx.history_rungs.filter((r) => r !== "fetch");
    const target = agentRungs.length ? agentRungs[agentRungs.length - 1] : nextRungUp("fetch", ctx.skipped);
    if (target === null) return escalate("fetch", ctx);
    return makePatch({
      next_rung: target,
      output_schema: schema,
      goal_suffix: suffix,
      summary: [`Back to ${RUNG_LABEL[target]}`, ...summary],
    });
  }

  const dataInCache = ctx.fetch_extraction_found || expectedMatchesText(ctx.request.expected, ctx.fetch_text);
  if (ctx.fetch_text_available && !ctx.reextract_tried && (ctx.rung === "fetch" || dataInCache)) {
    // (a) the data is in the page text we already have: re-read it for free.
    return makePatch({
      next_rung: ctx.rung !== "fetch" ? "fetch" : null,
      reextract_from_fetch: true,
      output_schema: deriveSchema(ctx.request.expected, ctx.current_schema),
      summary: [SUMMARY_REEXTRACT],
    });
  }

  if (ctx.rung === "fetch") return escalate("fetch", ctx);
  // (c) tighten in place.
  return makePatch({ output_schema: schema, goal_suffix: suffix, summary });
}

/**
 * Decide the next move for a diagnosed failure. The LLM's suggested prefix/suffix (only passed
 * when the LLM made the diagnosis) is used when it is short enough.
 */
export function plan(failureClass: FailureClass, context: PlanContext, llmPrefix = "", llmSuffix = ""): Patch {
  const ctx = withDefaults(context);
  if (failureClass === "captcha") {
    return makePatch({ stop: true, stop_reason: STOP_CAPTCHA, summary: ["Stop: CAPTCHA (unrecoverable)"] });
  }
  if (failureClass === "auth_wall") {
    return makePatch({ stop: true, stop_reason: STOP_AUTH, summary: ["Stop: login required (unrecoverable)"] });
  }

  if (failureClass === "bot_block") {
    if (ctx.rung === "agent_stealth") {
      return makePatch({
        stop: true,
        stop_reason: `Still blocked with a stealth browser and a ${ctx.proxy_country} proxy — stopping honestly.`,
        summary: ["Stop: still blocked on rung 3"],
      });
    }
    const skip: Rung[] = ctx.rung === "fetch" ? ["agent"] : [];
    const summary = [`Escalate to rung 3: stealth browser + ${ctx.proxy_country} proxy`];
    if (skip.length) summary.push("Skip rung 2: Fetch already hit a bot wall");
    return makePatch({
      next_rung: "agent_stealth",
      skip_rungs: skip,
      browser_profile: "stealth",
      proxy_enabled: true,
      summary,
    });
  }

  if (isRepeat(failureClass, ctx)) {
    return escalate(
      ctx.rung,
      ctx,
      `Same failure (${failureClass}) twice on the top rung — stopping instead of burning credits.`,
    );
  }

  if (failureClass === "popup_overlay") {
    const prefix = usableLlmText(llmPrefix) || POPUP_PREFIX;
    if (ctx.rung === "fetch") {
      const target = nextRungUp("fetch", ctx.skipped);
      if (target === null) return escalate("fetch", ctx);
      return makePatch({
        next_rung: target,
        goal_prefix: prefix,
        summary: [SUMMARY_POPUP, `Escalate to ${RUNG_LABEL[target]}`],
      });
    }
    return makePatch({ goal_prefix: prefix, summary: [SUMMARY_POPUP, `Stay on ${RUNG_LABEL[ctx.rung]}`] });
  }

  if (failureClass === "needs_interaction") {
    if (ctx.rung === "fetch") return escalate("fetch", ctx);
    return makePatch({ goal_suffix: INTERACT_SUFFIX, summary: [SUMMARY_INTERACT] });
  }

  return planMisread(ctx, llmSuffix);
}
