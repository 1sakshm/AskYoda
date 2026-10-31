---
name: askyoda
description: Get verified data from websites with the askyoda CLI (TinyFish web agents + an independent verifier). Use this whenever the user wants information pulled from a live web page and the answer has to be right, not just plausible — lists that span pagination, infinite scroll or "Load more" buttons, prices, job listings, product catalogs, resumes or profiles on personal sites, tables behind tabs or clicks, or anything where a plain fetch or a single agent run might quietly return a partial answer. Also use it when the user mentions TinyFish, AskYoda, web agents that "said done but weren't", or asks to scrape, extract, collect or look something up on a specific site.
---

# AskYoda: verified web data

AskYoda runs a goal on a website with TinyFish, then **checks the answer itself** instead of
trusting the agent's own "COMPLETED". When an attempt falls short it diagnoses why (needs a
click, popup, bot block, misread page, login wall, CAPTCHA), patches the next attempt, and climbs
a cost ladder only as far as needed:

1. **Fetch** — reads page text; free (needs an LLM key for extraction, skipped without one)
2. **Agent** — a real TinyFish browser that clicks, scrolls and pages (~1 credit per step)
3. **Agent + stealth + proxy** — only when blocked or when the plain agent keeps falling short

Login walls and CAPTCHAs stop immediately as **needs_human** instead of burning credits.

## Before you run

- Requires Node 18+ and a TinyFish key in the environment: `TINYFISH_API_KEY`
  (from https://agent.tinyfish.ai/api-keys). Runs bill to the user's own TinyFish account.
- Optional but recommended: `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`. With an LLM key the free
  Fetch rung can answer simple pages for 0 credits, and diagnoses get smarter. Without one,
  everything still works on built-in rules. When using a Gemini key, pass
  `--model gemini-3.5-flash-lite` by default: the package's default Gemini model has a free
  tier of only ~20 requests a day, and Flash-Lite's is far larger.
- If `TINYFISH_API_KEY` is missing, stop and tell the user how to get one rather than trying
  to scrape the site another way — the whole point is the verified result.
- Never print or log the keys.

## The check is what makes the answer trustworthy

AskYoda can only reject a wrong answer if it knows what a right one looks like, so always pass a
check that encodes the user's real requirement. A weak check lets a partial answer pass early:
asking for a resume with only `--fields name,experience` once "verified" from a portfolio
homepage with no education section, while `--fields name,experience,education,resume_url` made
AskYoda click through to the real resume page.

Pick the check from what the user actually needs:

| User wants | Check |
|---|---|
| a list ("all products", "every job", "the quotes") | `--min-items <path>:<N>` with N = the count they expect, or a safe floor if the page states a total |
| specific fields of one record (profile, resume, product page) | `--fields a,b,c` listing every field they asked for, including ones that need a click (e.g. `resume_url`) |
| a known fact to confirm (a price, a name) | `--contains "TEXT"` or `--regex "PATTERN"` |

The `<path>` in `--min-items` is the key the list will live under in the JSON result. Name it in
the goal too ("…return them as laptops") so the agent and the check agree.

`--min-items` is a floor, not an exact count. If the user wants "the first 5", say "the first 5"
in the goal and trim `result` to 5 when presenting it.

## Running it

```sh
npx -y askyoda run "<url>" "<goal in plain English>" \
  --min-items laptops:20 \
  --model gemini-3.5-flash-lite \
  --max-credits 40 \
  --json
```

- Write the goal the way a person would ask, and say what to return
  ("List the laptops in this shop with their name and price, as laptops."). Keep backticks and
  `$` out of the goal: inside a double-quoted shell string they get interpreted.
- `--json` prints one JSON object at the end; drop it if the user wants to watch progress live.
- Let it start at Fetch by default: it's free, and when the text isn't enough AskYoda moves to
  the browser agent on its own. Use `--start agent` only to save a step when you already know
  the page needs a browser (infinite scroll, "Load more", tabs, pagination you must click).
- Other flags: `--max-attempts N`, `--proxy CC`, `--schema file.json`,
  `--llm gemini|anthropic|none`, `--model NAME`.
- Defaults: 40 credits and 4 attempts, capped independently (`--max-credits`,
  `--max-attempts`). Mention the budget to the user for big jobs, and ask before raising credits
  above ~60.
- Runs take from seconds (Fetch) to a few minutes (multi-page agent runs). Use a long command
  timeout (10 minutes) rather than letting the shell kill it mid-run.

Exit codes: `0` verified · `2` needs human escalation · `3` budget spent · `1` error ·
`64` bad input.

## Reading the result

The `--json` output is large (full attempt configs). Read just `status`, `result`, `reason`,
`creditsUsed` and `attemptsUsed`; look at `diagnoses` only when you need to explain a failure.
Ignore `streaming_url`s unless the user wants to watch a run live.

Diagnoses are AskYoda's best explanation of why an attempt fell short, not ground truth: a
Fetch attempt can be labelled "needs interaction" when the text simply didn't contain the data
(for example titles truncated in a listing). For a verified run the user cares about the answer
and the cost, so don't relay intermediate diagnoses unless they ask.

- **`verified`** — use `result`; it passed the check. Present it cleanly (tables for lists),
  and mention the cost: "verified on attempt 2, 12 credits".
- **`needs_human`** — a login wall, CAPTCHA, or a site that blocks every browser. Tell the user
  plainly what blocked it (the `reason` says) and that a person has to take it from here. Don't
  try to log in, solve CAPTCHAs, or retry with tricks.
- **`budget_exhausted`** — it ran out of attempts/credits before the answer passed. Report the
  closest result honestly as partial ("16 of the 20 positions"), show what the diagnoses said,
  and ask whether to retry with a larger budget or a different check. Never present a partial
  answer as verified.
- **`error` / `cancelled`** — report the reason; a TinyFish 429/503 usually just needs a retry
  in a minute.

When the data looks inconsistent across pages of the same site (e.g. an outdated resume page vs.
a newer homepage), say so instead of silently picking one.

## In code

When the user is building something rather than asking for data once:

```ts
import { AskYoda } from "askyoda";

const yoda = new AskYoda({
  tinyfishKey: process.env.TINYFISH_API_KEY!,
  llm: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY!, model: "gemini-3.5-flash-lite" },
});

const run = await yoda.run({
  url, goal,
  expect: { minItems: { path: "laptops", min: 20 } }, // or { fieldsPresent: [...] }, { contains }, { regex }
  maxCredits: 40,
  onEvent: (e) => { if (e.type === "live_view") console.log("watch:", e.streaming_url); },
});
// run.status, run.result, run.reason, run.creditsUsed, run.diagnoses
```

`yoda.stream(...)` gives the same events as an async iterator.

## Be a good citizen

Only fetch what the user is entitled to see and would reasonably expect: public pages, at a
human pace (one run at a time). Respect login walls, paywalls and CAPTCHAs — AskYoda escalating
to a human is the intended outcome there, not a problem to work around. For pages about private
individuals, extract what the user asked for from that source and don't go compiling profiles
across other sites.

More: https://askyoda.vercel.app (recorded runs with video) ·
https://www.npmjs.com/package/askyoda
