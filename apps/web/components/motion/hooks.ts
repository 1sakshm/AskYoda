"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the visitor asked for reduced motion (false during server rendering). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/**
 * Whether the element is on screen. With `once`, it stays true after the first time, so an
 * entrance animation plays a single time; without it, looping diagrams can pause offscreen.
 */
export function useInView(
  ref: RefObject<Element | null>,
  { once = false, threshold = 0.25 }: { once?: boolean; threshold?: number } = {},
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, threshold]);
  return inView;
}

/** Whether the tab is visible, so looping animations stop in background tabs. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => !document.hidden,
    () => true,
  );
}

/**
 * A step counter for looping diagrams: advances through `durations` (ms per step), then
 * restarts. Pauses while `running` is false. Returns the current step index.
 */
export function useStepper(durations: number[], running: boolean): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setStep((s) => (s + 1) % durations.length),
      durations[step] ?? 1000,
    );
    return () => window.clearTimeout(timer);
  }, [step, running, durations]);
  return step;
}
