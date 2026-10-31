"use client";

import { useRef } from "react";

import { useInView, useReducedMotion } from "@/components/motion/hooks";

interface Props {
  /** What one plain TinyFish run delivered, e.g. "said COMPLETED · 8 of 24 jobs". */
  aloneOutcome: string;
  /** Whether that plain run passed the verifier. Defaults to false (the usual story here). */
  alonePassed?: boolean;
  /** What AskYoda delivered on the same page, e.g. "verified · 24 of 24 jobs". */
  askyodaOutcome: string;
  /** Whether AskYoda's run ended verified (true) or stopped for a human (false). */
  askyodaPassed?: boolean;
  /** Attempts AskYoda needed; 2+ draws the retry loop. */
  attempts?: number;
  className?: string;
}

/**
 * Two lanes on the same page: TinyFish alone runs straight through and its answer is taken as
 * is; AskYoda's run meets the verifier gate, loops back with a patch and comes out checked.
 * Draws once when scrolled into view; reduced motion shows the finished picture.
 */
export default function AloneVsAskYoda({
  aloneOutcome,
  alonePassed = false,
  askyodaOutcome,
  askyodaPassed = true,
  attempts = 2,
  className = "",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, threshold: 0.4 });
  const reduced = useReducedMotion();
  const play = inView || reduced;
  const retry = attempts > 1;

  const draw = (delayMs: number, len = 220) =>
    play
      ? {
          className: "ay-draw",
          style: { animationDelay: `${delayMs}ms`, ["--ay-len" as string]: len },
        }
      : { className: "opacity-0", style: {} };

  const stamp = (delayMs: number) =>
    play
      ? { className: "ay-pop", style: { animationDelay: `${delayMs}ms` } }
      : { className: "opacity-0", style: {} };

  const aloneStamp = stamp(1000);
  const askStamp = stamp(retry ? 2300 : 1100);
  const gateFlash =
    play && retry ? "transition-colors delay-[700ms] duration-300 fill-ochre-400" : "fill-ink-600";

  return (
    <div ref={ref} className={`space-y-4 ${className}`}>
      {/* Lane 1: TinyFish alone */}
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr_minmax(0,14rem)]">
        <span className="kicker">TinyFish alone</span>
        <svg viewBox="0 0 200 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden>
          <circle cx="4" cy="12" r="3.5" className="fill-ink-400" />
          <path
            d="M8 12 H194"
            className={`stroke-ink-400 ${draw(0).className}`}
            style={draw(0).style}
            strokeWidth="1.5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className={`col-span-2 inline-flex items-center gap-2 justify-self-start rounded-md border px-2.5 py-1 text-sm sm:col-span-1 ${
            alonePassed ? "border-ink-600 text-ink-200" : "border-ember-500/60 text-ember-300"
          } ${aloneStamp.className}`}
          style={aloneStamp.style}
        >
          <span aria-hidden>{alonePassed ? "✓" : "✕"}</span>
          <span className="truncate">{aloneOutcome}</span>
        </span>
      </div>

      {/* Lane 2: with AskYoda */}
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr_minmax(0,14rem)]">
        <span className="kicker !text-moss-300">With AskYoda</span>
        <svg viewBox="0 0 200 40" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
          <circle cx="4" cy="28" r="3.5" className="fill-moss-400" />
          <path
            d="M8 28 H96"
            className={`stroke-moss-500 ${draw(0, 100).className}`}
            style={draw(0, 100).style}
            strokeWidth="1.5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {/* The verifier gate. */}
          <rect x="97" y="18" width="5" height="20" rx="1.5" className={gateFlash} />
          {retry && (
            <path
              d="M96 22 C 90 4, 60 4, 54 22"
              className={`stroke-ochre-400 ${draw(900, 70).className}`}
              style={draw(900, 70).style}
              strokeWidth="1.5"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d="M103 28 H194"
            className={`stroke-moss-400 ${draw(retry ? 1500 : 500, 100).className}`}
            style={draw(retry ? 1500 : 500, 100).style}
            strokeWidth="1.5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className={`col-span-2 inline-flex items-center gap-2 justify-self-start rounded-md border px-2.5 py-1 text-sm sm:col-span-1 ${
            askyodaPassed
              ? "border-moss-400/70 text-moss-300"
              : "border-ochre-500/60 text-ochre-300"
          } ${askStamp.className}`}
          style={askStamp.style}
        >
          <span aria-hidden>{askyodaPassed ? "✓" : "⏸"}</span>
          <span className="truncate">{askyodaOutcome}</span>
        </span>
      </div>
      <p className="sr-only">
        TinyFish alone: {alonePassed ? "passed" : "failed"}, {aloneOutcome}. With AskYoda:{" "}
        {askyodaOutcome}
        {retry ? `, after ${attempts} attempts` : ""}.
      </p>
    </div>
  );
}
