/** The ladder end to end, with scripted TinyFish and LLM fakes (no network). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AskYoda } from "../src/askyoda.js";
import { LadderController } from "../src/controller.js";
import { STOP_AUTH } from "../src/planner.js";
import { TinyFishConnectError, TinyFishError } from "../src/tinyfish.js";
import type { AskYodaEvent, FetchExtraction, Run, RunRequest } from "../src/types.js";
import { makeExpected } from "../src/types.js";
import { FakeLlm, FakeTinyFish, SAMPLE_FETCH, runRecord, sseRun } from "./fakes.js";

const PRODUCTS = {
  products: [
    { name: "Blue Mug", price: "$12.00" },
    { name: "Red Kettle", price: "$39.00" },
    { name: "Green Teapot", price: "$24.50" },
  ],
};
const NOT_FOUND: FetchExtraction = {
  found: false,
  result_json: "",
  missing: ["products"],
  interaction_hint: "The product grid only says 'Loading products…' behind a cookie notice; it needs a real browser to load.",
};
const SAMPLE_REQUEST: RunRequest = {
  url: "https://shop.example.com/products",
  goal: "List the first 3 products on the page with their name and price.",
  expected: makeExpected({ type: "min_items", path: "products", min: 3 }),
  output_schema: null,
  start_rung: "fetch",
};
const SAMPLE_RUN = fileURLToPath(new URL("./fixtures/sample-run.jsonl", import.meta.url));
const sampleEvents = (): Record<string, any>[] =>
  readFileSync(SAMPLE_RUN, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function sampleTinyFish() {
  return new FakeTinyFish({
    fetch: [SAMPLE_FETCH],
    streams: [
      sseRun("tf_sample_0001", [
        "Navigating to https://shop.example.com/products",
        "A cookie consent dialog is covering the page",
        "Looking for the product grid behind the dialog",
        "Could not read any products; finishing",
      ]),
      sseRun(
        "tf_sample_0002",
        [
          "Navigating to https://shop.example.com/products",
          "Clicking 'Accept all' on the cookie dialog",
          "The dialog is closed; the product grid is visible",
          "Reading the first 3 products",
          "Extracting names and prices",
        ],
        { result: PRODUCTS },
      ),
    ],
    runs: { tf_sample_0001: runRecord("tf_sample_0001", 4), tf_sample_0002: runRecord("tf_sample_0002", 5) },
  });
}

async function execute(
  tinyfish: FakeTinyFish,
  llm: FakeLlm | null,
  request: Partial<RunRequest> = {},
  opts: { maxAttempts?: number; maxCredits?: number; runId?: string } = {},
): Promise<[Run, AskYodaEvent[]]> {
  const run: Run = {
    id: opts.runId ?? "run1",
    created_at: "2026-11-01T11:00:00.000Z",
    finished_at: null,
    request: { ...SAMPLE_REQUEST, ...request },
    status: "queued",
    attempts: [],
    credits_used: 0,
    max_attempts: opts.maxAttempts ?? 4,
    max_credits: opts.maxCredits ?? 40,
    final_result: null,
    verdict_reason: null,
    baseline_credits_estimate: null,
  };
  const events: AskYodaEvent[] = [];
  const ladder = new LadderController({
    tinyfish,
    llm,
    onEvent: (e) => {
      events.push(e);
    },
    sleep: async () => {},
  });
  await ladder.execute(run);
  return [run, events];
}

const types = (events: readonly object[]) => events.map((e) => (e as { type: string }).type);

/** Drop what legitimately differs between a live run and the fixture (times, ids, raw). */
function comparable(event: Record<string, any>): Record<string, any> {
  const { ts: _ts, run_id: _r, ...e } = event;
  if (e.type === "trace_event") {
    const ev = e.event;
    e.event = Object.fromEntries(
      ["seq", "kind", "source", "step_no", "label", "tf_run_id", "attempt_no"].map((k) => [k, ev[k]]),
    );
  }
  return e;
}

describe("ladder", () => {
  it("reproduces the sample run", async () => {
    const llm = new FakeLlm({ fetch_extraction: [NOT_FOUND] });
    const [run, events] = await execute(sampleTinyFish(), llm);
    const sample = sampleEvents();
    expect(types(events)).toEqual(types(sample));
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));

    const diagnoses = events.flatMap((e) => (e.type === "diagnosis" ? [e.diagnosis] : []));
    expect(diagnoses.map((d) => [d.failure_class, d.failing_step_seq, d.source])).toEqual([
      ["needs_interaction", 2, "rules"],
      ["popup_overlay", 4, "rules"],
    ]);
    const labels = events.flatMap((e) => (e.type === "trace_event" ? [e.event.label] : []));
    expect(labels).toEqual(sample.filter((e) => e.type === "trace_event").map((e) => e.event.label));

    const starts = events.flatMap((e) => (e.type === "attempt_started" ? [e.config] : []));
    expect(starts.map((c) => [c.rung, c.credit_limit])).toEqual([
      ["fetch", 0],
      ["agent", 40],
      ["agent", 36],
    ]);
    expect(starts[1].patches_applied).toEqual(["Escalate to Rung 2 · Agent"]);

    const verdict = events[events.length - 1];
    expect(verdict.type).toBe("verdict");
    if (verdict.type !== "verdict") return;
    expect([verdict.status, verdict.credits_used, verdict.attempts_used]).toEqual(["verified", 9, 3]);
    expect(verdict.baseline_credits_estimate).toBe(15);
    expect(verdict.reason).toBe("Verified on attempt 3 (Rung 2 · Agent) after fixing needs_interaction → popup_overlay.");
    expect(run.status).toBe("verified");
    expect(run.final_result).toEqual(PRODUCTS);
    expect(llm.callsFor("fetch_extraction").length).toBe(1);
    expect(llm.calls.length).toBe(1);
  });

  it("matches the sample fixture field by field", async () => {
    const [, events] = await execute(sampleTinyFish(), new FakeLlm({ fetch_extraction: [NOT_FOUND] }), {}, { runId: "sample" });
    const sample = sampleEvents();
    expect(events.length).toBe(sample.length);
    events.forEach((got, i) => expect(comparable(got as never), `seq ${sample[i].seq}`).toEqual(comparable(sample[i])));
  });

  it("stops on an auth wall after one attempt", async () => {
    const tinyfish = new FakeTinyFish({ fetch: [{ results: [], errors: [{ url: "u", error: "login_required" }] }] });
    const [run] = await execute(tinyfish, new FakeLlm());
    expect(run.status).toBe("unrecoverable");
    expect([run.attempts.length, run.credits_used]).toEqual([1, 0]);
    expect(run.verdict_reason).toBe(STOP_AUTH);
    expect(tinyfish.bodies).toEqual([]);
  });

  it("skips the plain agent and uses stealth after a bot block at Fetch", async () => {
    const tinyfish = new FakeTinyFish({
      fetch: [{ results: [], errors: [{ url: "u", error: "bot_blocked" }] }],
      streams: [sseRun("tf_s", ["Loading", "Reading products"], { result: PRODUCTS })],
      runs: { tf_s: runRecord("tf_s", 2, { proxy: true }) },
    });
    const [run, events] = await execute(tinyfish, new FakeLlm());
    const change = events.filter((e) => e.type === "rung_change")[1];
    if (change.type !== "rung_change") throw new Error();
    expect([change.from_rung, change.to_rung, change.skipped]).toEqual(["fetch", "agent_stealth", ["agent"]]);
    expect(tinyfish.bodies[0].browser_profile).toBe("stealth");
    expect(tinyfish.bodies[0].proxy_config).toEqual({ enabled: true, country_code: "US" });
    expect(run.status).toBe("verified");
  });

  it("ends in budget_exhausted after a credit-limit cancel", async () => {
    const tinyfish = new FakeTinyFish({
      streams: [sseRun("tf_b", Array.from({ length: 10 }, (_, i) => `step ${i}`), { status: "CANCELLED" })],
    });
    const [run] = await execute(tinyfish, new FakeLlm(), { start_rung: "agent" }, { maxCredits: 5 });
    expect(tinyfish.cancelled).toEqual(["tf_b"]);
    expect(run.status).toBe("budget_exhausted");
    expect(run.verdict_reason).toBe("Budget spent: the attempt was cancelled at the credit limit.");
  });

  it("skips rung 1 without an LLM", async () => {
    const tinyfish = new FakeTinyFish({ streams: [sseRun("tf_n", ["Reading"], { result: PRODUCTS })] });
    const [run, events] = await execute(tinyfish, null);
    const first = events.find((e) => e.type === "rung_change");
    if (first?.type !== "rung_change") throw new Error();
    expect([first.to_rung, first.skipped]).toEqual(["agent", ["fetch"]]);
    expect(tinyfish.fetched).toEqual([]);
    expect(run.status).toBe("verified");
  });

  it("ends with an error verdict on a hard TinyFish refusal", async () => {
    const tinyfish = new FakeTinyFish({ streams: [new TinyFishError("INSUFFICIENT_CREDITS", "wallet empty", 402)] });
    const [run] = await execute(tinyfish, new FakeLlm(), { start_rung: "agent" });
    expect(run.status).toBe("error");
    expect(run.verdict_reason).toBe("TinyFish refused the request: INSUFFICIENT_CREDITS — wallet empty");
  });

  it("retries without output_schema when the account lacks the entitlement", async () => {
    const schema = { type: "object", properties: { products: { type: "array", items: { type: "string" } } } };
    const tinyfish = new FakeTinyFish({
      streams: [
        new TinyFishError("FORBIDDEN", "output_schema provided without the output-schema entitlement"),
        sseRun("tf_o", ["Reading"], { result: PRODUCTS }),
      ],
    });
    const [run] = await execute(tinyfish, new FakeLlm(), { start_rung: "agent", output_schema: schema });
    expect("output_schema" in tinyfish.bodies[0]).toBe(true);
    expect("output_schema" in tinyfish.bodies[1]).toBe(false);
    expect(run.status).toBe("verified");
    expect(run.attempts.length).toBe(2);
  });

  it("runs out of attempts into budget_exhausted", async () => {
    const tinyfish = new FakeTinyFish({ streams: [sseRun("a", ["Reading the page"]), sseRun("b", ["Reading the page"])] });
    const [run] = await execute(tinyfish, null, { start_rung: "agent" }, { maxAttempts: 2 });
    expect(run.status).toBe("budget_exhausted");
    expect(run.verdict_reason!.startsWith("Budget spent: 2/2 attempts used")).toBe(true);
  });

  it("stops before paying when too few credits are left", async () => {
    const tinyfish = new FakeTinyFish({ streams: [sseRun("tf_l", ["a", "b", "c"])] });
    const [run] = await execute(tinyfish, null, { start_rung: "agent" }, { maxCredits: 5 });
    expect(tinyfish.bodies.length).toBe(1);
    expect(run.status).toBe("budget_exhausted");
    expect(run.verdict_reason).toContain("not enough credits left");
  });

  it("warns when TinyFish did not apply the proxy", async () => {
    const tinyfish = new FakeTinyFish({
      streams: [sseRun("tf_p", ["Reading"], { result: PRODUCTS })],
      runs: { tf_p: runRecord("tf_p", 1, { proxy: false }) },
    });
    const [run, events] = await execute(tinyfish, null, { start_rung: "agent_stealth" });
    const labels = events.flatMap((e) => (e.type === "trace_event" ? [e.event.label] : []));
    expect(labels).toContain("Warning: TinyFish reports the proxy was not applied");
    expect(tinyfish.bodies[0].browser_profile).toBe("stealth");
    expect(run.attempts[0].config.proxy_country).toBe("US");
  });

  it("fixes a misread with a free re-extraction from the cached Fetch", async () => {
    const page = {
      url: "https://books.toscrape.com/x",
      final_url: "https://books.toscrape.com/x",
      title: "A Light in the Attic",
      text: "# A Light in the Attic\n\nPrice (incl. tax) £51.77\n\nAvailability: In stock (22 available)",
    };
    const tinyfish = new FakeTinyFish({
      fetch: [{ results: [page], errors: [] }],
      streams: [sseRun("tf_m", ["Reading the availability"], { result: { copies: "In stock" } })],
      runs: { tf_m: runRecord("tf_m", 3) },
    });
    const llm = new FakeLlm({
      fetch_extraction: [
        { found: false, result_json: "", missing: ["copies"], interaction_hint: "" },
        { found: true, result_json: '{"answer": "22"}', missing: [], interaction_hint: "" },
      ],
    });
    const [run, events] = await execute(tinyfish, llm, {
      url: "https://books.toscrape.com/x",
      goal: "How many copies are available?",
      expected: makeExpected({ type: "regex", value: "\\b22\\b" }),
    });
    expect(run.attempts.map((a) => a.rung)).toEqual(["fetch", "agent", "fetch"]);
    expect(run.attempts[2].config.from_fetch_cache).toBe(true);
    expect(run.attempts[2].config.output_schema).toEqual({ type: "object", properties: { answer: { type: "string" } }, required: ["answer"] });
    expect(tinyfish.fetched).toEqual(["https://books.toscrape.com/x"]);
    expect(run.credits_used).toBe(3);
    expect(run.status).toBe("verified");
    expect(run.verdict_reason).toBe("Verified on attempt 3 (Rung 1 · Fetch) after fixing needs_interaction → misread_page.");
    const labels = events.flatMap((e) => (e.type === "trace_event" ? [e.event.label] : []));
    expect(labels).toContain("Using cached Fetch text (0 credits)");
  });

  it("retries a connect error before a run instead of diagnosing it", async () => {
    const tinyfish = new FakeTinyFish({ streams: [new TinyFishConnectError("timed out"), sseRun("tf_c", ["Reading"], { result: PRODUCTS })] });
    const [run] = await execute(tinyfish, new FakeLlm(), { start_rung: "agent" });
    expect(run.status).toBe("verified");
    expect(run.attempts.length).toBe(1);
    expect(run.attempts[0].diagnosis).toBeNull();
    expect(tinyfish.bodies.length).toBe(2);
  });
});

describe("AskYoda", () => {
  it("maps unrecoverable to needs_human and validates input", async () => {
    const yoda = new AskYoda({
      tinyfish: new FakeTinyFish({ fetch: [{ results: [], errors: [{ url: "u", error: "login_required" }] }] }),
      llm: new FakeLlm(),
    });
    const r = await yoda.run({ url: "https://x.example/account", goal: "Return my name", expect: { fieldsPresent: ["name"] } });
    expect(r.status).toBe("needs_human");
    expect(r.ok).toBe(false);
    expect(r.reason.startsWith("Needs human escalation:")).toBe(true);
    expect(r.creditsUsed).toBe(0);
    await expect(yoda.run({ url: "ftp://x", goal: "g" })).rejects.toThrow("url must start");
    await expect(yoda.run({ url: "https://x", goal: "g", expect: { minItems: { path: "a", min: 0 } } })).rejects.toThrow("min");
  });

  it("streams events and returns the result", async () => {
    const yoda = new AskYoda({ tinyfish: new FakeTinyFish({ streams: [sseRun("tf_x", ["Reading"], { result: PRODUCTS })] }) });
    const gen = yoda.stream({ url: "https://shop.example.com", goal: "List products", expect: { minItems: { path: "products", min: 3 } } });
    const seen: string[] = [];
    let next = await gen.next();
    while (!next.done) {
      seen.push(next.value.type);
      next = await gen.next();
    }
    expect(seen[0]).toBe("budget");
    expect(seen[seen.length - 1]).toBe("verdict");
    expect(next.value.status).toBe("verified");
    expect(next.value.result).toEqual(PRODUCTS);
  });

  it("cancels on abort and keeps the cost", async () => {
    const abort = new AbortController();
    const tinyfish = new FakeTinyFish({ streams: [sseRun("tf_a", ["one", "two"], { result: PRODUCTS })] });
    const yoda = new AskYoda({ tinyfish });
    const r = await yoda.run({
      url: "https://shop.example.com",
      goal: "List products",
      startRung: "agent",
      signal: abort.signal,
      onEvent: (e) => {
        if (e.type === "trace_event" && e.event.kind === "progress") abort.abort();
      },
    });
    expect(r.status).toBe("cancelled");
    expect(tinyfish.cancelled).toEqual(["tf_a"]);
  });
});
