"use client";

import { useEffect, useRef, useState } from "react";

import { useInView, useReducedMotion } from "@/components/motion/hooks";
import { CLI_TRANSCRIPT } from "@/lib/cliTranscript";

type Tok = [string, string?];

// Hand-tokenized so the colours stay in the site palette (no highlighter dependency).
const K = "text-clay-300"; // keywords
const S = "text-moss-300"; // strings
const P = "text-ochre-300"; // properties
const C = "text-ink-500"; // comments
const N = "text-tangerine-300"; // numbers

const TS: Tok[][] = [
  [["import", K], [" { AskYoda } "], ["from", K], [' "askyoda"', S], [";"]],
  [[""]],
  [
    ["const", K],
    [" yoda = "],
    ["new", K],
    [" AskYoda({ "],
    ["tinyfishKey", P],
    [": process.env.TINYFISH_API_KEY });"],
  ],
  [[""]],
  [["const", K], [" run = "], ["await", K], [" yoda.run({"]],
  [
    ["  url", P],
    [": "],
    ['"https://webscraper.io/test-sites/e-commerce/more/computers/laptops"', S],
    [","],
  ],
  [["  goal", P], [": "], ['"List the laptops in this shop with their prices."', S], [","]],
  [
    ["  expect", P],
    [": { "],
    ["minItems", P],
    [": { "],
    ["path", P],
    [": "],
    ['"laptops"', S],
    [", "],
    ["min", P],
    [": "],
    ["20", N],
    [" } },"],
  ],
  [["});"]],
  [[""]],
  [["run.status", P], ["  "], ['// "verified" — checked, not trusted', C]],
  [["run.result", P], ["  "], ['// all 30 laptops, after clicking "More"', C]],
  [["run.diagnoses", P], [" "], ["// what failed, where, and the fix applied", C]],
];

function TsPane() {
  return (
    <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-ink-100">
      {TS.map((line, i) => (
        <div key={i} className="min-h-6 whitespace-pre">
          {line.map(([text, cls], j) => (
            <span key={j} className={cls}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}

function lineClass(line: string): string {
  if (line.startsWith("$")) return "text-ink-50";
  if (/verified|✓/i.test(line)) return "text-moss-300";
  if (/rejected|✕|failed/i.test(line)) return "text-ember-300";
  if (/diagnos|patch|misread|retry|escalat|^\s*[→◆]/i.test(line)) return "text-ochre-300";
  return "text-ink-300";
}

/** Plays a real CLI run line by line once the window is on screen. */
function CliPane() {
  const ref = useRef<HTMLPreElement>(null);
  const inView = useInView(ref, { once: true, threshold: 0.3 });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const total = CLI_TRANSCRIPT.length;
  const count = reduced ? total : shown;

  useEffect(() => {
    if (reduced || !inView || shown >= total) return;
    const delay = shown === 0 ? 300 : CLI_TRANSCRIPT[shown - 1].startsWith("$") ? 700 : 260;
    const t = window.setTimeout(() => setShown((n) => n + 1), delay);
    return () => window.clearTimeout(t);
  }, [inView, reduced, shown, total]);

  // Follow the output like a real terminal, so the verdict at the end is what you see.
  useEffect(() => {
    const el = ref.current;
    if (el && !reduced) el.scrollTop = el.scrollHeight;
  }, [shown, reduced]);

  return (
    <pre
      ref={ref}
      className="h-full overflow-auto p-5 font-mono text-[12.5px] leading-6"
      aria-label="Output of a real askyoda CLI run"
    >
      {CLI_TRANSCRIPT.slice(0, count).map((line, i) => (
        <div key={i} className={`whitespace-pre-wrap break-words ${lineClass(line)}`}>
          {line || " "}
        </div>
      ))}
      {count < total && <span className="inline-block h-4 w-2 animate-pulse bg-moss-400" />}
    </pre>
  );
}

/** The hero's code window: the library call, and a real CLI run replayed. */
export default function CodeShowcase() {
  const [tab, setTab] = useState<"ts" | "cli">("cli");
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-950/90 shadow-[0_40px_120px_-50px_rgb(191_209_102/0.25)]">
      <div className="flex items-center gap-3 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
        </span>
        <div role="tablist" className="flex gap-1">
          {(
            [
              ["cli", "Terminal"],
              ["ts", "TypeScript"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                tab === key ? "bg-ink-700 text-ink-50" : "text-ink-400 hover:text-ink-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="kicker ml-auto hidden sm:inline">
          {tab === "cli" ? "real run · replayed" : "index.ts"}
        </span>
      </div>
      <div className="h-[22rem]">{tab === "cli" ? <CliPane /> : <TsPane />}</div>
    </div>
  );
}
