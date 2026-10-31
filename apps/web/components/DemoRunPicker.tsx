"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  SAMPLE_NOTE,
  demoRunId,
  loadDemoIndex,
  orderForDisplay,
  type DemoRun,
} from "@/lib/demoIndex";
import { CLASS_COLOR, CLASS_LABEL, STATUS_LABEL, STATUS_STYLE, fmtCredits } from "@/lib/format";

function RunCard({ run }: { run: DemoRun }) {
  const sample = run.kind === "sample";
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-900/80 p-6 transition-colors hover:border-ink-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">{sample ? "Illustrative sample" : "Recording"}</span>
        {run.status && (
          <span className={`font-mono text-xs tracking-wide ${STATUS_STYLE[run.status]}`}>
            {STATUS_LABEL[run.status]}
          </span>
        )}
      </div>
      <h3 className="font-display text-2xl leading-tight text-ink-50">{run.title}</h3>
      {sample && (
        <p className="rounded-lg border border-ochre-800/60 bg-ochre-950/60 px-3 py-2 text-sm text-ochre-200">
          {SAMPLE_NOTE}
        </p>
      )}
      {run.url && (
        <p className="truncate font-mono text-xs text-ink-400" title={run.url}>
          {run.url}
        </p>
      )}
      {run.goal && <p className="text-ink-200">{run.goal}</p>}
      {run.classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {run.classes.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-500">→</span>}
              <span className={`rounded-full px-2.5 py-0.5 ${CLASS_COLOR[c]}`}>
                {CLASS_LABEL[c]}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-ink-700/70 pt-4">
        <p className="font-mono text-xs text-ink-400">
          {run.attempts_used} attempt{run.attempts_used === 1 ? "" : "s"} ·{" "}
          {fmtCredits(run.credits_used)}
          {run.baseline_credits_estimate !== null &&
            ` · baseline ${fmtCredits(run.baseline_credits_estimate)}`}
        </p>
        <Link href={`/runs/${demoRunId(run.id)}`} className="btn-ghost px-4 py-1.5 text-sm">
          Play ▸
        </Link>
      </div>
    </article>
  );
}

/** The runs bundled with the static demo, each playable in the browser. */
export default function DemoRunPicker() {
  const [runs, setRuns] = useState<DemoRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex()
      .then((index) => {
        if (!cancelled) setRuns(orderForDisplay(index.runs));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-ember-300">Can&apos;t load the bundled runs: {error}</p>;
  if (!runs) return <p className="animate-pulse text-ink-400">Loading bundled runs…</p>;
  if (runs.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-ink-400">
        No recorded runs are bundled yet.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}
