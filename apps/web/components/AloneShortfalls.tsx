"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AloneComparison from "@/components/AloneComparison";
import AloneVsAskYoda from "@/components/diagrams/AloneVsAskYoda";
import {
  aloneFailed,
  demoRunId,
  loadDemoIndex,
  orderForDisplay,
  type DemoRun,
} from "@/lib/demoIndex";
import { CLASS_COLOR, CLASS_LABEL } from "@/lib/format";

/**
 * The recorded cases where one plain TinyFish run failed the verifier, side by side with the
 * AskYoda run on the same page. Renders nothing until such a recording is bundled.
 */
export default function AloneShortfalls() {
  const [runs, setRuns] = useState<DemoRun[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex()
      .then((index) => {
        if (cancelled) return;
        setRuns(
          orderForDisplay(index.runs.filter((r) => r.kind === "recording" && aloneFailed(r))),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (runs.length === 0) return null;
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Recorded side by side</p>
          <h2 className="mt-2 font-display text-4xl tracking-tight text-ink-50">
            Where TinyFish alone falls short
          </h2>
        </div>
        <p className="max-w-md text-ink-300">
          The same page, the same goal: one plain TinyFish run, then AskYoda. Both answers are
          judged by the same verifier.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {runs.map((run) => {
          const cls = run.alone?.failure_class ?? run.expected_class ?? null;
          return (
            <article
              key={run.id}
              className="flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-900/80 p-6 transition-colors hover:border-ink-500"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="kicker">
                  {run.site_kind === "real" ? "Real website" : "Test page"}
                </span>
                {cls && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ${CLASS_COLOR[cls]}`}>
                    {CLASS_LABEL[cls]}
                  </span>
                )}
              </div>
              <h3 className="font-display text-2xl leading-tight text-ink-50">{run.title}</h3>
              {run.goal && <p className="text-sm text-ink-300">“{run.goal}”</p>}
              <AloneVsAskYoda
                aloneOutcome={run.alone?.verify_summary ?? "failed the check"}
                alonePassed={run.alone?.passed ?? false}
                askyodaOutcome={
                  run.status === "verified" ? `verified · ${run.credits_used} cr` : "stopped"
                }
                askyodaPassed={run.status === "verified"}
                attempts={run.attempts_used}
              />
              <AloneComparison run={run} />
              <div className="mt-auto border-t border-ink-700/70 pt-4">
                <Link href={`/runs/${demoRunId(run.id)}`} className="btn-primary px-4 py-2 text-sm">
                  Watch the AskYoda run ▸
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
