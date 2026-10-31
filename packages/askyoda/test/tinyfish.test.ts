import { describe, expect, it } from "vitest";

import { TinyFishClient, TinyFishError, buildAgentBody, mapSseEvent, normalizeTfError, uiCopy } from "../src/tinyfish.js";
import type { TraceKind } from "../src/types.js";
import { cfg } from "./fakes.js";

const AGENT = "https://agent.tinyfish.ai";
const FETCH = "https://api.fetch.tinyfish.ai";
const NOW = "2026-11-01T11:00:00.000Z";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as typeof fetch;
  return { impl, calls };
}

const client = (impl: typeof fetch, sleeps: number[] = []) =>
  new TinyFishClient("test-key", {
    agentBase: AGENT,
    fetchBase: FETCH,
    fetchImpl: impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

describe("TinyFishClient", () => {
  it("parses SSE data lines and skips the rest", async () => {
    const body =
      ": keep-alive comment\n\n" +
      'data: {"type":"STARTED","run_id":"r1","timestamp":"t0"}\n\n' +
      "event: message\n" +
      'data: {"type":"PROGRESS","run_id":"r1","purpose":"Clicking","timestamp":"t1"}\n\n' +
      "data: not-json\n\n" +
      'data: {"type":"COMPLETE","run_id":"r1","status":"COMPLETED","result":null}\n\n';
    const { impl, calls } = mockFetch([() => new Response(body, { headers: { "content-type": "text/event-stream" } })]);
    const events = [];
    for await (const e of client(impl).agentStream({ url: "u", goal: "g" })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["STARTED", "PROGRESS", "_UNPARSEABLE", "COMPLETE"]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key");
    expect(headers.Accept).toBe("text/event-stream");
    expect(calls[0].url).toBe(`${AGENT}/v1/automation/run-sse`);
  });

  it("parses SSE split across chunks with CRLF", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"type":"STA'));
        c.enqueue(enc.encode('RTED","run_id":"r1"}\r\n\r\ndata: {"type":"COMPLETE"}'));
        c.close();
      },
    });
    const { impl } = mockFetch([() => new Response(stream)]);
    const events = [];
    for await (const e of client(impl).agentStream({})) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["STARTED", "COMPLETE"]);
  });

  it("throws before yielding on an HTTP error", async () => {
    const { impl } = mockFetch([
      () =>
        new Response(JSON.stringify({ error: { code: "insufficient_credits", message: "wallet empty" }, request_id: "req-1" }), {
          status: 402,
        }),
    ]);
    let yielded = false;
    let err: TinyFishError | null = null;
    try {
      for await (const _ of client(impl).agentStream({ url: "u", goal: "g" })) yielded = true;
    } catch (e) {
      err = e as TinyFishError;
    }
    expect(yielded).toBe(false);
    expect(err).toBeInstanceOf(TinyFishError);
    expect([err!.code, err!.httpStatus, err!.requestId]).toEqual(["INSUFFICIENT_CREDITS", 402, "req-1"]);
  });

  it("retries Fetch once on 429", async () => {
    const ok = { results: [{ url: "u", text: "# Hi" }], errors: [] };
    const { impl, calls } = mockFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "1" } }),
      () => new Response(JSON.stringify(ok)),
    ]);
    const sleeps: number[] = [];
    expect(await client(impl, sleeps).fetch("https://example.com")).toEqual(ok);
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(calls[1].init.body).toBe('{"urls":["https://example.com"],"format":"markdown"}');
  });

  it("reports an error without a JSON body", async () => {
    const { impl } = mockFetch([() => new Response("boom", { status: 500 })]);
    await expect(client(impl).fetch("https://example.com")).rejects.toMatchObject({ code: "HTTP_500", detail: "boom" });
  });

  it("gets a run and cancels it", async () => {
    const { impl, calls } = mockFetch([
      () => new Response(JSON.stringify({ run_id: "r1" })),
      () => new Response(JSON.stringify({ status: "CANCELLED" })),
    ]);
    const c = client(impl);
    expect((await c.getRun("r1")).run_id).toBe("r1");
    expect((await c.cancel("r1")).status).toBe("CANCELLED");
    expect(calls[0].url).toBe(`${AGENT}/v1/runs/r1?screenshots=none`);
    expect(calls[1].url).toBe(`${AGENT}/v1/runs/r1/cancel`);
  });
});

describe("buildAgentBody", () => {
  it("lite body has no proxy and no gated fields", () => {
    expect(buildAgentBody(cfg("agent", { url: "https://shop.example.com/products", goal: "List the first 3 products" }))).toEqual({
      url: "https://shop.example.com/products",
      goal: "List the first 3 products",
      browser_profile: "lite",
      agent_config: { max_duration_seconds: 150 },
    });
  });

  it("stealth body is exactly the documented shape", () => {
    const c = cfg("agent_stealth", {
      url: "https://shop.example.com/products",
      goal: "List the first 3 products",
      browser_profile: "stealth",
      proxy_enabled: true,
      proxy_country: "US",
    });
    expect(buildAgentBody(c)).toEqual({
      url: "https://shop.example.com/products",
      goal: "List the first 3 products",
      browser_profile: "stealth",
      agent_config: { max_duration_seconds: 150 },
      proxy_config: { enabled: true, country_code: "US" },
    });
    const withSchema = buildAgentBody({ ...c, output_schema: { type: "object", properties: { a: { type: "string" } } } });
    expect((withSchema.output_schema as Record<string, unknown>).type).toBe("object");
    expect("capture_config" in withSchema).toBe(false);
  });
});

describe("mapSseEvent", () => {
  it.each<[Record<string, unknown>, TraceKind, string]>([
    [{ type: "STARTED", run_id: "r1", timestamp: "t" }, "started", "Agent started"],
    [{ type: "STREAMING_URL", streaming_url: "https://x" }, "live_view", "Live view ready"],
    [{ type: "PROGRESS", purpose: " Clicking submit " }, "progress", "Clicking submit"],
    [{ type: "PROGRESS" }, "progress", "(no purpose)"],
    [{ type: "HEARTBEAT", timestamp: "t" }, "heartbeat", "heartbeat"],
    [{ type: "COMPLETE", status: "FAILED" }, "complete", "Agent finished: FAILED"],
    [{ type: "TF_API_RESULT", tinyfish_api: "fetch" }, "tf_api_result", "Agent used TinyFish fetch"],
    [{ type: "_UNPARSEABLE", line: "x" }, "unknown", "Unparseable stream line"],
    [{ type: "SOMETHING_NEW" }, "unknown", "Unknown event SOMETHING_NEW"],
  ])("%j", (raw, kind, label) => {
    const e = mapSseEvent(raw, { runId: "run", attemptNo: 2, seq: 5, stepNo: 3, now: NOW });
    expect([e.kind, e.label, e.source]).toEqual([kind, label, "tinyfish_sse"]);
    expect(e.raw).toEqual(raw);
    expect(e.step_no).toBe(kind === "progress" ? 3 : null);
  });

  it("keeps TinyFish ids", () => {
    const e = mapSseEvent({ type: "STARTED", run_id: "tf_1", timestamp: "2026-11-01T11:00:04Z" }, { runId: "run", attemptNo: 1, seq: 1, stepNo: null, now: NOW });
    expect([e.tf_run_id, e.tf_timestamp]).toEqual(["tf_1", "2026-11-01T11:00:04Z"]);
  });
});

describe("normalizeTfError", () => {
  it("string error with top-level help", () => {
    const err = normalizeTfError({ type: "COMPLETE", error: "Site blocked", help_url: "h", help_message: "m" })!;
    expect(err.message).toBe("Site blocked");
    expect(err.code).toBeNull();
    expect([err.help_url, err.help_message]).toEqual(["h", "m"]);
  });

  it("object error uppercases the code and reads a nested hint", () => {
    const err = normalizeTfError({
      status: "FAILED",
      error: {
        code: "site_blocked",
        message: "Target site blocked the automation.",
        category: "AGENT_FAILURE",
        retry_after: null,
        profile_hint: { message: "m", setup_url: "/s", reason: "bot_challenge" },
      },
    })!;
    expect(err.code).toBe("SITE_BLOCKED");
    expect(err.category).toBe("AGENT_FAILURE");
    expect(err.profile_hint_reason).toBe("bot_challenge");
  });

  it("top-level profile hint, and no error", () => {
    expect(normalizeTfError({ status: "COMPLETED", result: { a: 1 } })).toBeNull();
    expect(normalizeTfError({ profile_hint: { reason: "auth_wall" } })!.profile_hint_reason).toBe("auth_wall");
  });
});

describe("uiCopy", () => {
  it("truncates long strings without touching the original", () => {
    const long = "x".repeat(2500);
    const e = mapSseEvent({ type: "COMPLETE", result: { text: long, items: [long] } }, { runId: "run", attemptNo: 1, seq: 1, stepNo: null, now: NOW });
    const copy = uiCopy(e);
    const result = copy.raw.result as { text: string; items: string[] };
    expect(result.text.endsWith("…[truncated 500 chars]")).toBe(true);
    expect(result.items[0].length).toBeLessThan(2100);
    expect((e.raw.result as { text: string }).text).toBe(long);
  });
});
