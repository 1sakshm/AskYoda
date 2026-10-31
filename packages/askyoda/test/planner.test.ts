import { describe, expect, it } from "vitest";

import {
  INTERACT_SUFFIX,
  MISREAD_SUFFIX,
  POPUP_PREFIX,
  composeGoal,
  deriveSchema,
  nextRungUp,
  plan,
  type PlanContext,
} from "../src/planner.js";
import { tinyfishSchemaErrors } from "../src/schema.js";
import type { Diagnosis, ExpectedCheck, FailureClass, JsonObject, Rung } from "../src/types.js";
import { makeExpected, makePatch } from "../src/types.js";

const DOCS_EXAMPLE = {
  type: "object",
  properties: {
    title: { type: "string" },
    price: { type: "number", minimum: 0 },
    published_at: { type: "string", format: "date-time", nullable: true },
    tags: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["title", "price"],
  propertyOrdering: ["title", "price", "published_at", "tags"],
};

describe("tinyfishSchemaErrors", () => {
  it("accepts the docs example", () => expect(tinyfishSchemaErrors(DOCS_EXAMPLE)).toEqual([]));

  it("accepts a list schema with an anyOf field", () => {
    const schema = {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, url: { type: "string" } },
            required: ["name", "url"],
          },
        },
        price: { anyOf: [{ type: "number" }, { type: "string", enum: ["free"] }] },
      },
      required: ["results"],
    };
    expect(tinyfishSchemaErrors(schema)).toEqual([]);
  });

  it.each<[unknown, string]>([
    [{ type: "object", additionalProperties: false }, "additionalProperties"],
    [{ type: "object", properties: { a: { oneOf: [] } } }, "oneOf"],
    [{ type: "object", properties: { a: { const: "x" } } }, "const"],
    [{ type: "object", properties: { a: { type: ["string", "null"] } } }, "type arrays"],
    [{ type: "object", properties: { a: { type: "number", enum: ["1"] } } }, "enum"],
    [{ type: "object", properties: { a: { type: "string", format: "uri" } } }, "format"],
    [{ type: "object", properties: { a: { type: "string", minItems: 1 } } }, "minItems"],
    [{ type: "object", required: ["missing"], properties: {} }, "required fields"],
    [{ type: "array", items: { type: "string" } }, "top-level"],
    [{ anyOf: [{ type: "object" }] }, "top-level"],
    [{ type: "object", properties: { a: true } }, "boolean schema"],
  ])("rejects %j naming the problem", (schema, needle) => {
    const errors = tinyfishSchemaErrors(schema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(needle))).toBe(true);
  });

  it("enforces the depth limit", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 11; i++) node = { type: "object", properties: { x: node } };
    expect(tinyfishSchemaErrors(node).some((e) => e.includes("depth"))).toBe(true);
  });
});

const REQ = { expected: null };
const ctx = (rung: Rung, kw: Partial<PlanContext> = {}): PlanContext => ({ rung, request: REQ, ...kw });
const diag = (cls: FailureClass): Diagnosis => ({
  attempt_no: 1,
  failure_class: cls,
  recoverable: true,
  confidence: 0.9,
  failing_step_seq: null,
  failing_step_label: null,
  evidence: [{ source: "verifier", quote: "x", event_seq: null }],
  explanation: "x",
  patch: makePatch(),
  source: "rules",
});

describe("plan: rung movement", () => {
  it.each<FailureClass>(["captcha", "auth_wall"])("%s stops", (cls) => {
    const patch = plan(cls, ctx("agent"));
    expect(patch.stop && patch.stop_reason).toBeTruthy();
  });

  it("bot block from Fetch skips the plain agent", () => {
    const patch = plan("bot_block", ctx("fetch", { proxy_country: "US" }));
    expect(patch.next_rung).toBe("agent_stealth");
    expect(patch.skip_rungs).toEqual(["agent"]);
    expect(patch.summary).toEqual(["Escalate to rung 3: stealth browser + US proxy", "Skip rung 2: Fetch already hit a bot wall"]);
  });

  it("bot block from the agent escalates without skipping", () => {
    const patch = plan("bot_block", ctx("agent"));
    expect([patch.next_rung, patch.skip_rungs]).toEqual(["agent_stealth", []]);
  });

  it("bot block on stealth stops honestly", () => {
    const patch = plan("bot_block", ctx("agent_stealth", { proxy_country: "US" }));
    expect(patch.stop).toBe(true);
    expect(patch.stop_reason).toContain("stealth browser and a US proxy");
  });

  it("needs interaction on Fetch escalates to the next open rung", () => {
    expect(plan("needs_interaction", ctx("fetch")).summary).toEqual(["Escalate to Rung 2 · Agent"]);
    expect(plan("needs_interaction", ctx("fetch", { skipped: new Set<Rung>(["agent"]) })).next_rung).toBe("agent_stealth");
  });

  it("popup adds the dismiss prefix and stays", () => {
    const patch = plan("popup_overlay", ctx("agent"));
    expect(patch.next_rung).toBeNull();
    expect(patch.stop).toBe(false);
    expect(patch.goal_prefix).toBe(POPUP_PREFIX);
    expect(patch.summary).toEqual(["Goal prefix: close cookie/consent dialogs before anything else", "Stay on Rung 2 · Agent"]);
  });

  it("popup uses a short LLM prefix but not a long one", () => {
    expect(plan("popup_overlay", ctx("agent"), "Click 'Got it' first.").goal_prefix).toBe("Click 'Got it' first.");
    expect(plan("popup_overlay", ctx("agent"), "x".repeat(301)).goal_prefix).toBe(POPUP_PREFIX);
  });

  it("popup seen by Fetch escalates with the prefix", () => {
    const patch = plan("popup_overlay", ctx("fetch"));
    expect([patch.next_rung, patch.goal_prefix]).toEqual(["agent", POPUP_PREFIX]);
  });

  it("repeat rule escalates, then stops at the top", () => {
    expect(plan("popup_overlay", ctx("agent", { history: [diag("popup_overlay")], history_rungs: ["agent"] })).next_rung).toBe("agent_stealth");
    const patch = plan("misread_page", ctx("agent_stealth", { history: [diag("misread_page")], history_rungs: ["agent_stealth"] }));
    expect(patch.stop).toBe(true);
    expect(patch.stop_reason).toContain("twice on the top rung");
  });

  it("repeat rule ignores a different previous class or rung", () => {
    expect(plan("popup_overlay", ctx("agent", { history: [diag("needs_interaction")], history_rungs: ["fetch"] })).next_rung).toBeNull();
  });

  it("composeGoal dedupes and caps length", () => {
    expect(composeGoal("G", ["P", "P"], ["S", "P"])).toBe("P\n\nG\n\nS");
    const long = composeGoal("G", [], ["a".repeat(1500), "b".repeat(600)]);
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith("b".repeat(600))).toBe(true);
  });

  it("nextRungUp", () => {
    expect(nextRungUp("fetch", new Set())).toBe("agent");
    expect(nextRungUp("fetch", new Set<Rung>(["agent"]))).toBe("agent_stealth");
    expect(nextRungUp("agent_stealth", new Set())).toBeNull();
  });
});

const REGEX_22 = { expected: makeExpected({ type: "regex", value: "\\b22\\b" }) };

describe("plan: content patches", () => {
  it("needs interaction on an agent rung adds the interaction suffix", () => {
    const patch = plan("needs_interaction", ctx("agent"));
    expect([patch.next_rung, patch.goal_suffix]).toEqual([null, INTERACT_SUFFIX]);
  });

  it("re-extracts a misread for free when the answer is in the cached page", () => {
    const patch = plan("misread_page", {
      rung: "agent",
      request: REGEX_22,
      fetch_text_available: true,
      fetch_text: "Availability: In stock (22 available)",
    });
    expect([patch.next_rung, patch.reextract_from_fetch]).toEqual(["fetch", true]);
    expect(patch.output_schema).toEqual({ type: "object", properties: { answer: { type: "string" } }, required: ["answer"] });
    expect(patch.summary).toEqual(["Re-extract from the cached Fetch text with a tighter schema (0 credits)"]);
  });

  it("a failed re-extract goes back to the agent rung with schema and suffix", () => {
    const patch = plan("misread_page", {
      rung: "fetch",
      request: REGEX_22,
      from_fetch_cache: true,
      history_rungs: ["fetch", "agent"],
      history: [diag("needs_interaction"), diag("misread_page")],
      fetch_text_available: true,
      reextract_tried: true,
    });
    expect(patch.next_rung).toBe("agent");
    expect(patch.goal_suffix).toBe(MISREAD_SUFFIX);
    expect(patch.summary[0]).toBe("Back to Rung 2 · Agent");
  });

  it("a misread without cache tightens in place", () => {
    const patch = plan("misread_page", { rung: "agent", request: { expected: makeExpected({ type: "min_items", path: "items", min: 5 }) } });
    expect(patch.next_rung).toBeNull();
    expect(patch.reextract_from_fetch).toBe(false);
    expect(patch.output_schema).toBeNull();
    expect(patch.goal_suffix).toBe(MISREAD_SUFFIX + " Return at least 5 items in 'items'.");
  });

  it("appends a short LLM hint and respects schema entitlement", () => {
    const patch = plan(
      "misread_page",
      { rung: "agent", request: { expected: makeExpected({ type: "contains", value: "x" }) }, schema_entitled: false },
      "",
      "Use the sale price, not the list price.",
    );
    expect(patch.output_schema).toBeNull();
    expect(patch.goal_suffix!.endsWith(" Use the sale price, not the list price.")).toBe(true);
  });

  it("repeat rule sees any earlier attempt on the same rung", () => {
    const patch = plan("misread_page", {
      rung: "agent",
      request: REGEX_22,
      history: [diag("misread_page"), diag("misread_page")],
      history_rungs: ["agent", "fetch"],
    });
    expect(patch.next_rung).toBe("agent_stealth");
  });

  it("deriveSchema from fields and from an existing schema", () => {
    const fields: ExpectedCheck = makeExpected({ type: "fields_present", fields: ["title", "price.amount", "items.0.name"] });
    const schema = deriveSchema(fields, null) as Record<string, any>;
    expect(schema.required).toEqual(["title", "price", "items"]);
    expect(schema.properties.price.required).toEqual(["amount"]);
    expect(schema.properties.items.type).toBe("array");
    expect(schema.properties.items.items.required).toEqual(["name"]);
    expect(tinyfishSchemaErrors(schema)).toEqual([]);

    const existing: JsonObject = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } }, t: { type: "string" } },
    };
    const tightened = deriveSchema(null, existing) as Record<string, any>;
    expect(tightened.required).toEqual(["tags", "t"]);
    expect(tightened.properties.tags.minItems).toBe(1);
    expect("required" in existing).toBe(false);
    expect(deriveSchema(null, null)).toBeNull();
  });
});
