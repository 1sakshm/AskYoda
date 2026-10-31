"use client";

import { useRef } from "react";

import { useInView, usePageVisible, useReducedMotion, useStepper } from "@/components/motion/hooks";

type Tone = "ink" | "ember" | "khaki" | "moss";

interface Row {
  label: string;
  value: string;
  tone: Tone;
  mono?: boolean;
}

/** One real story from the lab: the careers page whose first answer was short. */
const ROWS: Row[] = [
  { label: "Attempt 1 · agent", value: "TinyFish says COMPLETED", tone: "ink" },
  { label: "Verifier", value: "✕ 8 jobs, need 20 — rejected", tone: "ember" },
  { label: "Diagnosis", value: "Misread page · at COMPLETED", tone: "khaki" },
  { label: "Patch", value: "+ Return at least 20 items", tone: "moss", mono: true },
  { label: "Attempt 2 · agent", value: "Reads pages 1–3 · 24 jobs", tone: "ink" },
];

// ms per step: an empty beat, one per row, then a long hold on the verdict.
const DURATIONS = [600, 1250, 1350, 1350, 1350, 1350, 3600];
const FINAL = DURATIONS.length - 1;

const DOT: Record<Tone, string> = {
  ink: "bg-ink-300",
  ember: "bg-ember-400",
  khaki: "bg-khaki-300",
  moss: "bg-moss-400",
};

const VALUE: Record<Tone, string> = {
  ink: "text-ink-100",
  ember: "text-ember-300",
  khaki: "text-khaki-300",
  moss: "text-moss-300",
};

/**
 * The core loop as a short, looping timeline: the agent says "done", the verifier rejects the
 * answer, the diagnosis names the failure, a patch goes into the retry, and the run is verified.
 * Pauses offscreen and in background tabs; reduced motion shows the finished story.
 */
export default function LoopDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const ticking = useStepper(DURATIONS, inView && visible && !reduced);
  const step = reduced ? FINAL : ticking;
  const shown = step; // rows with index < shown are on screen
  const done = step === FINAL;

  return (
    <div
      ref={ref}
      className="panel relative overflow-hidden p-5 sm:p-6"
      role="img"
      aria-label="A run: TinyFish reports completed, the verifier rejects 8 jobs when 20 are needed, the diagnosis is misread page at the agent's COMPLETED step, the retry is told to return at least 20 items, and the second attempt is verified with 24 jobs."
    >
      <div className="flex items-center justify-between" aria-hidden>
        <span className="kicker">run · careers page</span>
        <span className="flex items-center gap-2 font-mono text-[11px] text-ink-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${done ? "bg-moss-400" : "ay-pulse bg-ochre-400"}`}
          />
          {done ? "finished" : "running"}
        </span>
      </div>

      <ol className="relative mt-5 space-y-3" aria-hidden>
        {/* The rail fills as the story advances. */}
        <span className="absolute top-2 bottom-2 left-[5px] w-px bg-ink-700" />
        <span
          className="absolute top-2 left-[5px] w-px origin-top bg-moss-500/70 transition-transform duration-700 ease-out"
          style={{
            bottom: "0.5rem",
            transform: `scaleY(${Math.min(shown, ROWS.length) / ROWS.length})`,
          }}
        />
        {ROWS.map((row, i) => {
          const on = i < shown;
          const current = on && i === shown - 1 && !done;
          return (
            <li
              key={row.label}
              className={`relative flex items-start gap-4 transition-all duration-500 ease-out ${
                on ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
              }`}
            >
              <span
                className={`relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-ink-850 ${DOT[row.tone]} ${
                  current ? "ay-pulse" : ""
                }`}
              />
              <div className="min-w-0 flex-1 rounded-lg border border-ink-700/80 bg-ink-900/70 px-3 py-2">
                <div className="kicker !text-[10px]">{row.label}</div>
                <div
                  className={`mt-0.5 truncate text-sm ${VALUE[row.tone]} ${row.mono ? "font-mono text-xs" : ""}`}
                >
                  {row.value}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div
        className="mt-5 flex h-14 items-center justify-between border-t border-ink-700/70 pt-4"
        aria-hidden
      >
        <span className="font-mono text-xs text-ink-400">
          {done
            ? "2 attempts · answer checked"
            : `step ${Math.max(shown, 1)} of ${ROWS.length + 1}`}
        </span>
        {done && (
          <span
            key={`stamp-${ticking}`}
            className="ay-stamp rounded-md border-2 border-moss-400 px-3 py-1 font-display text-2xl text-moss-300"
          >
            Verified
          </span>
        )}
      </div>
    </div>
  );
}
