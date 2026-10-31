/**
 * askyoda CLI.
 *
 *   npx askyoda run <url> "<goal>" [--min-items path:N | --contains TEXT | --regex PATTERN |
 *       --fields a,b.c] [--max-credits 40] [--max-attempts 4] [--start fetch|agent|agent_stealth]
 *       [--schema file.json] [--proxy US] [--llm gemini|anthropic|none] [--model NAME] [--json]
 *
 * Keys come from the environment: TINYFISH_API_KEY (required), GEMINI_API_KEY or
 * ANTHROPIC_API_KEY (optional; enables Rung 1 and LLM diagnosis).
 */

import { readFileSync } from "node:fs";

import { AskYoda, AskYodaInputError, type Expectation, type RunResult } from "./askyoda.js";
import type { LlmOptions } from "./llm.js";
import type { AskYodaEvent, JsonObject, Rung } from "./types.js";
import { RUNG_LABEL } from "./types.js";

const VERSION = "0.1.0";

const HELP = `askyoda ${VERSION} — a reliability layer for TinyFish web agents

Usage
  askyoda run <url> "<goal>" [options]

Checks (pick one; it tells the verifier what a right answer looks like)
  --min-items <path:N>   the result must have a list at <path> with at least N items
  --contains <text>      the result must contain <text> (case-insensitive)
  --regex <pattern>      the result must match <pattern> (case-insensitive)
  --fields <a,b.c>       these dot paths must be present and non-empty

Options
  --schema <file.json>   TinyFish output_schema (JSON file)
  --start <rung>         fetch (default) | agent | agent_stealth
  --max-credits <n>      hard cap on TinyFish credits (default 40)
  --max-attempts <n>     hard cap on attempts (default 4)
  --proxy <CC>           proxy country for the stealth rung (default US)
  --llm <provider>       gemini | anthropic | none (default: whichever key is set)
  --model <name>         LLM model name
  --json                 print the final result as JSON (no live output)
  --quiet                only print the verdict
  -h, --help             show this help
  -v, --version          show the version

Environment
  TINYFISH_API_KEY       required — runs bill to your TinyFish account
  GEMINI_API_KEY         optional — enables Rung 1 (free Fetch) and LLM diagnosis
  ANTHROPIC_API_KEY      optional — same, with Claude

Exit codes: 0 verified · 2 needs human escalation · 3 budget spent · 1 error/cancelled`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  moss: paint("38;5;149"),
};

interface Args {
  command: string | null;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const booleans = new Set(["json", "quiet", "help", "version"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") flags.set("help", true);
    else if (a === "-v") flags.set("version", true);
    else if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (booleans.has(name)) flags.set(name, true);
      else if (inline !== undefined) flags.set(name, inline);
      else if (i + 1 < argv.length) flags.set(name, argv[++i]);
      else throw new AskYodaInputError(`--${name} needs a value`);
    } else positional.push(a);
  }
  return { command: positional.shift() ?? null, positional, flags };
}

function str(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function int(flags: Map<string, string | true>, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new AskYodaInputError(`--${name} must be an integer`);
  return n;
}

function expectationFrom(flags: Map<string, string | true>): Expectation | undefined {
  const given = ["min-items", "contains", "regex", "fields"].filter((k) => flags.has(k));
  if (given.length > 1) throw new AskYodaInputError("give only one of --min-items, --contains, --regex, --fields");
  const minItems = str(flags, "min-items");
  if (minItems !== undefined) {
    const m = /^(.+):(\d+)$/.exec(minItems);
    if (!m) throw new AskYodaInputError("--min-items must look like path:N, e.g. positions:20");
    return { minItems: { path: m[1], min: Number(m[2]) } };
  }
  const contains = str(flags, "contains");
  if (contains !== undefined) return { contains };
  const regex = str(flags, "regex");
  if (regex !== undefined) return { regex };
  const fields = str(flags, "fields");
  if (fields !== undefined) return { fieldsPresent: fields.split(",").map((f) => f.trim()).filter(Boolean) };
  return undefined;
}

function llmFrom(flags: Map<string, string | true>): LlmOptions | null {
  const choice = str(flags, "llm");
  const model = str(flags, "model");
  if (choice === "none") return null;
  const gemini = process.env.GEMINI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (choice === "gemini") {
    if (!gemini) throw new AskYodaInputError("--llm gemini needs GEMINI_API_KEY");
    return { provider: "gemini", apiKey: gemini, model };
  }
  if (choice === "anthropic") {
    if (!anthropic) throw new AskYodaInputError("--llm anthropic needs ANTHROPIC_API_KEY");
    return { provider: "anthropic", apiKey: anthropic, model };
  }
  if (choice !== undefined) throw new AskYodaInputError("--llm must be gemini, anthropic or none");
  if (anthropic) return { provider: "anthropic", apiKey: anthropic, model };
  if (gemini) return { provider: "gemini", apiKey: gemini, model };
  return null;
}

function printEvent(ev: AskYodaEvent): void {
  switch (ev.type) {
    case "rung_change": {
      const skipped = ev.skipped.length ? c.dim(` (skipping ${ev.skipped.map((r) => RUNG_LABEL[r]).join(", ")})`) : "";
      console.log(`${c.moss("▲")} ${c.bold(RUNG_LABEL[ev.to_rung])}${skipped}  ${c.dim(ev.reason)}`);
      break;
    }
    case "attempt_started": {
      const extra = [ev.config.browser_profile, ev.config.proxy_enabled ? `proxy ${ev.config.proxy_country}` : null, ...ev.config.patches_applied]
        .filter(Boolean)
        .join(" · ");
      console.log(`\n${c.bold(`Attempt ${ev.attempt_no}`)} ${c.dim(`· ${RUNG_LABEL[ev.rung]}${ev.rung === "fetch" ? "" : ` · ${extra}`}`)}`);
      break;
    }
    case "trace_event": {
      const e = ev.event;
      if (e.kind === "heartbeat" || e.kind === "run_snapshot") break;
      const step = e.step_no ? c.dim(`step ${e.step_no} `) : "";
      console.log(`  ${c.dim("·")} ${step}${e.label}`);
      break;
    }
    case "live_view":
      console.log(`  ${c.dim(`live view: ${ev.streaming_url}`)}`);
      break;
    case "verify":
      console.log(`  ${ev.result.passed ? c.green("✓") : c.red("✕")} ${ev.result.summary}`);
      break;
    case "diagnosis": {
      const d = ev.diagnosis;
      console.log(`  ${c.yellow("◆")} ${c.bold(d.failure_class)} ${c.dim(`(${d.source}, ${Math.round(d.confidence * 100)}%)`)} ${d.explanation}`);
      for (const e of d.evidence.slice(0, 2)) console.log(`    ${c.dim(`“${e.quote}”`)}`);
      if (d.patch.stop) console.log(`  ${c.red("■")} ${d.patch.stop_reason}`);
      else for (const s of d.patch.summary) console.log(`  ${c.moss("→")} ${s}`);
      break;
    }
    default:
      break;
  }
}

function printVerdict(r: RunResult): void {
  const head =
    r.status === "verified"
      ? c.green("VERIFIED")
      : r.status === "needs_human"
        ? c.red("NEEDS HUMAN ESCALATION")
        : r.status === "budget_exhausted"
          ? c.yellow("BUDGET SPENT")
          : c.red(r.status.toUpperCase());
  console.log(`\n${c.bold(head)}  ${r.reason}`);
  const baseline = r.baselineCreditsEstimate !== null ? ` · naive baseline ~${r.baselineCreditsEstimate}` : "";
  console.log(c.dim(`${r.attemptsUsed}/${r.maxAttempts} attempts · ${r.creditsUsed}/${r.maxCredits} credits (est.)${baseline}`));
  if (r.result) console.log(JSON.stringify(r.result, null, 2));
}

const EXIT: Record<RunResult["status"], number> = {
  verified: 0,
  needs_human: 2,
  budget_exhausted: 3,
  error: 1,
  cancelled: 1,
};

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags.has("version")) {
    console.log(VERSION);
    return 0;
  }
  if (args.flags.has("help") || args.command === null) {
    console.log(HELP);
    return args.command === null && !args.flags.has("help") ? 1 : 0;
  }
  if (args.command !== "run") throw new AskYodaInputError(`unknown command "${args.command}" (try: askyoda run --help)`);
  const [url, goal] = args.positional;
  if (!url || !goal) throw new AskYodaInputError('usage: askyoda run <url> "<goal>" [options]');
  const tinyfishKey = process.env.TINYFISH_API_KEY;
  if (!tinyfishKey) throw new AskYodaInputError("set TINYFISH_API_KEY (https://agent.tinyfish.ai/api-keys)");

  const schemaPath = str(args.flags, "schema");
  const outputSchema = schemaPath ? (JSON.parse(readFileSync(schemaPath, "utf8")) as JsonObject) : undefined;
  const json = args.flags.has("json");
  const quiet = args.flags.has("quiet");

  const yoda = new AskYoda({ tinyfishKey, llm: llmFrom(args.flags), proxyCountry: str(args.flags, "proxy") });
  const abort = new AbortController();
  process.once("SIGINT", () => {
    if (!json) console.error(c.dim("\ncancelling the TinyFish run…"));
    abort.abort();
  });

  if (!json && !quiet) {
    console.log(`${c.moss("AskYoda")} ${c.dim(`· ${url}`)}\n${c.dim("goal:")} ${goal}`);
    if (!yoda.hasLlm) console.log(c.dim("(no LLM key: Rung 1 is skipped and diagnosis uses the rules only)"));
  }
  const result = await yoda.run({
    url,
    goal,
    expect: expectationFrom(args.flags),
    outputSchema,
    startRung: str(args.flags, "start") as Rung | undefined,
    maxCredits: int(args.flags, "max-credits"),
    maxAttempts: int(args.flags, "max-attempts"),
    signal: abort.signal,
    onEvent: json || quiet ? undefined : printEvent,
  });
  if (json) {
    const { run: _run, ...rest } = result;
    console.log(JSON.stringify(rest, null, 2));
  } else printVerdict(result);
  return EXIT[result.status];
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`askyoda: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof AskYodaInputError ? 64 : 1;
  },
);
