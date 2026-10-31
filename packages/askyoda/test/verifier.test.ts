import { describe, expect, it } from "vitest";

import { toJsonSchema } from "../src/schema.js";
import type { CheckName, ExpectedCheck, Rung, VerifyResult } from "../src/types.js";
import { makeExpected } from "../src/types.js";
import { allEmpty, getPath } from "../src/util.js";
import { verify } from "../src/verifier.js";
import { attemptOf, ev } from "./fakes.js";

const PRODUCTS = {
  products: [
    { name: "Blue Mug", price: "$12.00" },
    { name: "Red Kettle", price: "$39.00" },
    { name: "Green Teapot", price: "$24.50" },
  ],
};
const MIN3 = makeExpected({ type: "min_items", path: "products", min: 3 });
const TRACE = [ev(1, "started"), ev(3, "progress", "A cookie consent dialog is covering the page"), ev(7, "complete")];

const att = (rung: Rung, fields: Parameters<typeof attemptOf>[1] = {}, schema: Record<string, unknown> | null = null) =>
  attemptOf(rung, { attempt_no: 2, ...fields }, { output_schema: schema as never });
const req = (expected: ExpectedCheck | null = null) => ({ expected });
const checkOf = (vr: VerifyResult, name: CheckName) => vr.checks.find((c) => c.name === name)!;

describe("verify", () => {
  it("rejects COMPLETED with a null result like the sample", () => {
    const vr = verify(att("agent", { tf_status: "COMPLETED", result: null }), req(MIN3), TRACE, null);
    expect(vr.passed).toBe(false);
    expect(vr.checks.map((c) => c.name)).toEqual(["tinyfish_status", "result_present", "no_block_page"]);
    expect(vr.summary).toBe("Rejected: Agent reported COMPLETED but result is null");
    const nullSignal = vr.block_signals.find((s) => s.kind === "null_result_completed")!;
    expect([nullSignal.where, nullSignal.event_seq]).toEqual(["result", 7]);
    expect(checkOf(vr, "no_block_page").passed).toBe(true);
  });

  it("verifies a good result with the expected detail", () => {
    const vr = verify(att("agent", { tf_status: "COMPLETED", result: PRODUCTS }), req(MIN3), TRACE, null);
    expect(vr.passed).toBe(true);
    expect(vr.summary).toBe("Verified: products has 3 items (≥ 3)");
    expect(vr.checks.map((c) => c.name)).toEqual([
      "tinyfish_status",
      "result_present",
      "self_reported_failure",
      "expected",
      "not_all_null",
      "no_block_page",
    ]);
    expect(checkOf(vr, "result_present").detail).toBe("result has 1 key");
  });

  it("rejects a failed status with the error", () => {
    const vr = verify(
      att("agent", { tf_status: "FAILED", tf_error: { code: "TASK_FAILED", message: "Could not navigate" } }),
      req(),
      TRACE,
      null,
    );
    expect(checkOf(vr, "tinyfish_status").detail).toBe("FAILED TASK_FAILED Could not navigate");
    expect(vr.passed).toBe(false);
  });

  it.each([
    [{ status: "failure", reason: "Could not find any products on the page" }],
    [{ error: "blocked" }],
    [{ reason: "nothing found" }],
  ])("flags self-reported failure %j", (result) => {
    const vr = verify(att("agent", { tf_status: "COMPLETED", result }), req(), TRACE, null);
    const check = checkOf(vr, "self_reported_failure");
    expect(check.passed).toBe(false);
    expect(check.detail.startsWith("result reports failure:")).toBe(true);
  });

  it("checks the output schema, with nullable", () => {
    const schema = {
      type: "object",
      properties: { price: { type: "number" }, note: { type: "string", nullable: true } },
      required: ["price", "note"],
    };
    const bad = verify(att("agent", { tf_status: "COMPLETED", result: { price: "$12", note: null } }, schema), req(), TRACE, null);
    expect(checkOf(bad, "output_schema").detail).toContain("price");
    const good = verify(att("agent", { tf_status: "COMPLETED", result: { price: 12, note: null } }, schema), req(), TRACE, null);
    expect(checkOf(good, "output_schema").passed).toBe(true);
  });

  it.each<[Partial<ExpectedCheck> & { type: ExpectedCheck["type"] }, boolean, string]>([
    [{ type: "contains", value: "red kettle" }, true, "found 'red kettle'"],
    [{ type: "contains", value: "Purple" }, false, "'Purple' not in result"],
    [{ type: "regex", value: "\\$39\\.00" }, true, "matches /\\$39\\.00/"],
    [{ type: "regex", value: "\\b22\\b" }, false, "no match for /\\b22\\b/"],
    [{ type: "fields_present", fields: ["products.0.name"] }, true, "all 1 fields present"],
    [{ type: "fields_present", fields: ["products.5.name"] }, false, "missing or empty"],
    [{ type: "min_items", path: "products", min: 4 }, false, "products has 3 items, need 4"],
    [{ type: "min_items", path: "items", min: 1 }, false, "items not found or not a list"],
  ])("expected check %j", (expected, passed, detail) => {
    const vr = verify(att("agent", { tf_status: "COMPLETED", result: PRODUCTS }), req(makeExpected(expected)), TRACE, null);
    const check = checkOf(vr, "expected");
    expect(check.passed).toBe(passed);
    expect(check.detail.startsWith(detail)).toBe(true);
  });

  it("rejects an all-empty result", () => {
    const vr = verify(att("agent", { tf_status: "COMPLETED", result: { products: [], title: null } }), req(), TRACE, null);
    expect(checkOf(vr, "not_all_null").passed).toBe(false);
  });

  it("treats access denied in the result as blocking", () => {
    const vr = verify(
      att("agent", { tf_status: "COMPLETED", result: { title: "Access Denied", body: "Reference #18" } }),
      req(),
      TRACE,
      null,
    );
    expect(vr.passed).toBe(false);
    expect(checkOf(vr, "no_block_page").detail.startsWith("access_denied in result")).toBe(true);
  });

  it("treats a captcha in progress only as evidence, not blocking", () => {
    const trace = [...TRACE, ev(4, "progress", "Solving the captcha on the page")];
    const vr = verify(att("agent", { tf_status: "COMPLETED", result: PRODUCTS }), req(MIN3), trace, null);
    expect(vr.passed).toBe(true);
    const signal = vr.block_signals.find((s) => s.kind === "captcha")!;
    expect([signal.where, signal.event_seq]).toEqual(["progress", 4]);
  });

  it("treats site blocked and profile hints as blocking", () => {
    const vr = verify(
      att("agent", { tf_status: "FAILED", tf_error: { code: "SITE_BLOCKED", message: "blocked", profile_hint_reason: "bot_challenge" } }),
      req(),
      TRACE,
      null,
    );
    const kinds = new Set(vr.block_signals.map((s) => s.kind));
    expect(kinds.has("site_blocked_error") && kinds.has("profile_hint_bot_challenge")).toBe(true);
  });
});

const fetchOf = (text: string | null = null, error: Record<string, unknown> | null = null) => ({
  results: text !== null ? [{ url: "u", final_url: "u", title: "t", text }] : [],
  errors: error ? [error] : [],
});

describe("verify (Fetch rung)", () => {
  it("rejects a fetch attempt with no extraction like the sample", () => {
    const trace = [ev(1, "fetch_result"), ev(2, "extraction")];
    const fetch = fetchOf("# Products\n\nWe use cookies. [Accept all]\n\nLoading products…");
    const vr = verify(att("fetch", { tf_status: "OK", result: null }), req(MIN3), trace, fetch);
    expect(vr.checks.map((c) => [c.name, c.passed, c.detail])).toEqual([
      ["tinyfish_status", true, "Fetch returned 1 page"],
      ["result_present", false, "Extractor found no data in the Fetch text"],
      ["no_block_page", true, "no blocking page detected"],
    ]);
    expect(vr.block_signals).toEqual([]);
  });

  it("treats a bot_blocked fetch error as blocking", () => {
    const vr = verify(att("fetch", { tf_status: "ERROR" }), req(), [ev(1, "fetch_error")], fetchOf(null, { url: "u", error: "bot_blocked" }));
    expect(checkOf(vr, "tinyfish_status").detail).toBe("Fetch error: bot_blocked");
    const signal = vr.block_signals.find((s) => s.kind === "fetch_bot_blocked")!;
    expect([signal.where, signal.event_seq]).toEqual(["fetch_error", 1]);
  });

  it("detects 403 and login_required", () => {
    const forbidden = verify(att("fetch", { tf_status: "ERROR" }), req(), [], fetchOf(null, { url: "u", error: "target_http_error", status: 403 }));
    expect(forbidden.block_signals.some((s) => s.kind === "http_403")).toBe(true);
    const login = verify(att("fetch", { tf_status: "ERROR" }), req(), [], fetchOf(null, { url: "u", error: "login_required" }));
    expect(login.block_signals.some((s) => s.kind === "fetch_login_required")).toBe(true);
  });

  it("ignores a benign reCAPTCHA footer", () => {
    const fetch = fetchOf("Contact us. This site is protected by reCAPTCHA and the Google Privacy Policy.");
    const vr = verify(att("fetch", { tf_status: "OK", result: { answer: "x" } }), req(), [], fetch);
    expect(vr.block_signals.some((s) => s.kind === "captcha")).toBe(false);
  });

  it("reads a real captcha in fetch text as a weak signal", () => {
    const vr = verify(att("fetch", { tf_status: "OK", result: null }), req(), [], fetchOf("Please verify you are human. Press & hold the button."));
    expect(vr.block_signals.find((s) => s.kind === "captcha")!.where).toBe("fetch_text");
  });
});

describe("helpers", () => {
  it("getPath, allEmpty, toJsonSchema", () => {
    expect(getPath(PRODUCTS, "products.1.name")).toEqual([true, "Red Kettle"]);
    expect(getPath(PRODUCTS, "products.9")).toEqual([false, null]);
    expect(allEmpty({ a: [], b: { c: null }, d: " " })).toBe(true);
    expect(allEmpty({ a: [0] })).toBe(false);
    expect(toJsonSchema({ type: "string", nullable: true, enum: ["a"] })).toEqual({ type: ["string", "null"], enum: ["a", null] });
  });
});
