"use client";

import { useRef } from "react";

import { useInView, useReducedMotion } from "@/components/motion/hooks";

interface Props {
  /** Width as a percentage of the track (0–100). */
  pct: number;
  /** Fill colour classes, e.g. "bg-moss-400". */
  fill: string;
  /** Delay before growing, in ms (to stagger several bars). */
  delayMs?: number;
  className?: string;
}

/**
 * A bar that grows from zero to `pct` the first time it scrolls into view, then animates
 * between values. Decorative: always pair it with a text label carrying the number.
 */
export default function GrowBar({ pct, fill, delayMs = 0, className = "h-3 rounded-full" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, threshold: 0.3 });
  const reduced = useReducedMotion();
  const width = inView || reduced ? Math.max(0, Math.min(pct, 100)) : 0;
  return (
    <div
      ref={ref}
      aria-hidden
      className={`shrink-0 transition-[width] duration-[1100ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] ${fill} ${className}`}
      style={{ width: `${width}%`, transitionDelay: `${delayMs}ms` }}
    />
  );
}
