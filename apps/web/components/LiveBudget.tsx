"use client";

import { useEffect, useState } from "react";

import { getHealth } from "@/lib/api";
import { liveBudgetSummary, type LiveBudgetSummary } from "@/lib/liveBudget";

const REFRESH_MS = 15_000;

/**
 * The shared spend budget of a hosted live demo (from GET /health). Renders nothing in local dev
 * (no shared cap) or when /health can't be reached.
 */
export default function LiveBudget() {
  const [budget, setBudget] = useState<LiveBudgetSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (document.hidden) return;
      getHealth()
        .then((health) => {
          if (!cancelled) setBudget(liveBudgetSummary(health));
        })
        .catch(() => {
          if (!cancelled) setBudget(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (!budget) return null;
  const { creditsLeft, creditCap, claude, liveRunActive } = budget;
  const ratio = creditCap > 0 ? creditsLeft / creditCap : 0;
  const status =
    creditsLeft === 0
      ? { dot: "bg-ember-400", text: "Shared budget used up — recorded runs still play" }
      : liveRunActive
        ? {
            dot: "bg-ochre-400 animate-pulse",
            text: "A live run is in progress — yours starts after",
          }
        : { dot: "bg-moss-400", text: "Ready for a live run" };

  return (
    <section
      aria-label="Shared live-run budget"
      className="panel flex flex-wrap items-center gap-x-10 gap-y-4 px-6 py-5"
    >
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${status.dot}`} aria-hidden />
        <span className="text-ink-100">{status.text}</span>
      </div>
      <div className="min-w-56 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="kicker">TinyFish credits left</span>
          <span className="font-mono text-sm text-ink-200">
            <span className="text-ink-50">{creditsLeft}</span> / {creditCap}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-700">
          <div
            className={`h-full rounded-full ${ratio > 0.25 ? "bg-moss-400" : "bg-ochre-400"}`}
            style={{ width: `${Math.max(0, Math.min(ratio, 1)) * 100}%` }}
          />
        </div>
      </div>
      {claude && (
        <div className="text-sm text-ink-300">
          <span className="kicker mr-2">LLM spend</span>
          <span className="font-mono text-ink-100">{claude.spent}</span> of{" "}
          <span className="font-mono">{claude.budget}</span>
        </div>
      )}
      <p className="w-full text-sm text-ink-400">
        Live runs call TinyFish for real and draw on a budget shared by everyone using this site.
      </p>
    </section>
  );
}
