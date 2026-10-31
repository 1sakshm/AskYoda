# askyoda

**Your agent said _done_. AskYoda checks.**

A reliability layer for [TinyFish](https://tinyfish.ai) web agents. Give it a URL, a plain-English
goal and (ideally) a check the answer must pass. AskYoda runs the goal on the cheapest TinyFish
rung that works, **verifies every answer itself** instead of trusting the agent's own `COMPLETED`,
**diagnoses** what went wrong and at which step, **patches** the next attempt, and **escalates to a
human** when no retry can help — all inside a hard budget of attempts and credits.

- Zero runtime dependencies · TypeScript types · ESM + CommonJS · Node ≥ 18
- Bring your own keys: runs bill to **your** TinyFish account
- Optional LLM (Gemini or Claude) for free Rung-1 extraction and harder diagnoses

```sh
npm install askyoda
```

## Quickstart

```ts
import { AskYoda } from "askyoda";

const yoda = new AskYoda({
  tinyfishKey: process.env.TINYFISH_API_KEY!,
  llm: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY! }, // optional
});

const run = await yoda.run({
  url: "https://askyoda.vercel.app/lab/jobs.html?v=2",
  goal: "List the open positions on this careers page with their title and team.",
  expect: { minItems: { path: "positions", min: 20 } },
  maxCredits: 25,
});

run.status;      // "verified" | "needs_human" | "budget_exhausted" | "error" | "cancelled"
run.result;      // the verified answer, e.g. { positions: [ ... 24 items ... ] }
run.reason;      // e.g. "Verified on attempt 4 (Rung 2 · Agent) after fixing misread_page → …"
run.creditsUsed; // estimated TinyFish credits (1 per agent step)
run.diagnoses;   // what failed, where, with quoted evidence, and the patch applied
```

On that paginated page (24 jobs, 8 per page) a plain TinyFish run reports `COMPLETED` with too
few positions. AskYoda's verifier rejects the short answer (the check needs 20), diagnoses it, and
the patched retry returns all 24 — in a live test, verified in 4 attempts for 10 credits.

### Live events

```ts
await yoda.run({
  url, goal, expect,
  onEvent: (e) => {
    if (e.type === "live_view") console.log("watch:", e.streaming_url);
    if (e.type === "diagnosis") console.log(e.diagnosis.failure_class, e.diagnosis.explanation);
  },
});

// or as an async iterator (the generator's return value is the RunResult)
for await (const e of yoda.stream({ url, goal, expect })) console.log(e.type);
```

Events: `budget`, `rung_change`, `attempt_started`, `trace_event` (every agent step),
`live_view` (TinyFish's live browser URL), `verify`, `diagnosis`, `verdict`. They use the same JSON
shape as the AskYoda web app, so you can store and replay them.

### Cancel

Pass an `AbortSignal`: the TinyFish run in flight is cancelled and the run ends as `cancelled`.

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 60_000);
await yoda.run({ url, goal, signal: ac.signal });
```

## CLI

```sh
export TINYFISH_API_KEY=...   # required
export GEMINI_API_KEY=...     # optional (or ANTHROPIC_API_KEY)

npx askyoda run https://askyoda.vercel.app/lab/jobs.html?v=2 \
  "List the open positions on this careers page with their title and team." \
  --min-items positions:20 --max-credits 25
```

| Flag | |
|---|---|
| `--min-items path:N` · `--contains TEXT` · `--regex PATTERN` · `--fields a,b.c` | the check (pick one) |
| `--schema file.json` | TinyFish `output_schema` |
| `--start fetch\|agent\|agent_stealth` | starting rung (default `fetch`) |
| `--max-credits N` · `--max-attempts N` | hard budget (defaults 40 / 4) |
| `--proxy CC` | proxy country for the stealth rung (default `US`) |
| `--llm gemini\|anthropic\|none` · `--model NAME` | LLM choice (default: whichever key is set) |
| `--json` · `--quiet` | machine-readable output · verdict only |

Exit codes: `0` verified · `2` needs human escalation · `3` budget spent · `1` error/cancelled.

## How it works

**1. A ladder, cheapest first.** A run stops at the first rung whose answer passes verification.

| Rung | What | Cost |
|---|---|---|
| 1 · Fetch | TinyFish Fetch reads the page text; an LLM extracts the answer | 0 credits (needs an LLM key; skipped without one) |
| 2 · Agent | TinyFish's browser agent, every step streamed | ~1 credit per step |
| 3 · Agent + stealth + proxy | anti-bot browser profile behind a proxy | only when blocked |

**2. An independent verifier.** Seven checks on every attempt: TinyFish status, result present,
self-reported failure, output schema, your expected check, not-all-empty, and block pages
(access denied, 403, login walls, CAPTCHAs).

**3. Diagnosis.** Deterministic rules first (R1–R9); an LLM only when the rules are unsure, and
its evidence quotes are kept only if they appear verbatim in what it was shown.

| Failure class | Next move |
|---|---|
| `needs_interaction` | escalate from Fetch, or tell the agent to click/search/"Load more"/"Next" |
| `popup_overlay` | prefix the goal with "close cookie/consent dialogs first" |
| `misread_page` | free re-extraction from the cached page, or a tighter schema + "return at least N items" |
| `bot_block` | jump to the stealth browser + proxy (skipping the plain agent if Fetch saw the wall) |
| `auth_wall` | **stop — needs human escalation** (0 wasted credits) |
| `captcha` | **stop — needs human escalation** |

A class that already failed once on a rung escalates instead of repeating; still blocked on
stealth stops honestly.

**4. A hard budget.** `maxAttempts` and `maxCredits` (estimated as 1 credit per agent step). The
TinyFish run is cancelled at the credit limit, and no agent attempt starts with fewer than 3
credits left. `baselineCreditsEstimate` reports what a naive "always stealth + proxy, run 3
times" approach would have cost.

## Options

```ts
new AskYoda({
  tinyfishKey: string,                    // required unless you pass `tinyfish`
  llm?: { provider: "gemini" | "anthropic", apiKey: string, model?: string } | LlmProvider,
  proxyCountry?: "US",                    // stealth rung proxy
  settings?: { agentMaxDurationS?: 150, agentMinCredits?: 3, rulesConfidenceThreshold?: 0.8,
               fetchTextMaxChars?: 12000, baselineDefaultSteps?: 15 },
  tinyfish?: TinyFishApi,                 // your own client (proxies, tests)
});

yoda.run({
  url: string, goal: string,
  expect?: { contains: string } | { regex: string | RegExp } | { fieldsPresent: string[] }
         | { minItems: { path: string, min: number } },
  outputSchema?: object,                  // TinyFish output_schema subset
  startRung?: "fetch" | "agent" | "agent_stealth",
  maxAttempts?: 4, maxCredits?: 40,
  signal?: AbortSignal, onEvent?: (event) => void,
});
```

Lower-level pieces are exported too: `verify`, `classify`, `diagnose`, `plan`, `TinyFishClient`,
`LadderController`, `tinyfishSchemaErrors`.

## Keys and costs

- **TinyFish** ([get a key](https://agent.tinyfish.ai/api-keys)): every agent attempt is a billed
  TinyFish run on your account. Fetch is free within TinyFish's allowance.
- **LLM** (optional): Gemini ([AI Studio](https://aistudio.google.com/apikey), has a free tier) or
  Anthropic. Used for at most one extraction per Fetch attempt and only for diagnoses the rules
  can't settle.

## Credits

Based on [agent-failure-autopsy](https://github.com/DevaanshPathak/agent-failure-autopsy) by
DevaanshPathak, used with permission. Web app and live demo: https://askyoda.vercel.app ·
source: https://github.com/1sakshm/AskYoda. MIT licensed.
