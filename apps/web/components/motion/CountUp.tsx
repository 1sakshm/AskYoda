"use client";

import { useEffect, useRef, useState } from "react";

import { useInView, useReducedMotion } from "@/components/motion/hooks";

interface Props {
  value: number;
  /** Total animation time in ms. */
  duration?: number;
  /** Text after the number, e.g. " cr". */
  suffix?: string;
  className?: string;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that counts up from 0 the first time it scrolls into view, and eases to new values
 * after that (so a polling page glides between numbers instead of jumping). The final value is
 * always in the DOM for screen readers; reduced motion shows it directly.
 */
export default function CountUp({ value, duration = 1100, suffix = "", className = "" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, threshold: 0.3 });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const next = Math.round(origin + (value - origin) * easeOut(t));
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, duration]);

  const display = reduced ? value : shown;
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      <span aria-hidden>
        {display.toLocaleString()}
        {suffix}
      </span>
      <span className="sr-only">
        {value.toLocaleString()}
        {suffix}
      </span>
    </span>
  );
}
