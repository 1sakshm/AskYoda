"use client";

import { useEffect, useState } from "react";

import ResultsTable from "@/components/ResultsTable";
import StatsTiles from "@/components/StatsTiles";
import { DEMO_MODE, getStats } from "@/lib/api";
import { demoIdFromRunId, demoStats, loadDemoIndex, type DemoRun } from "@/lib/demoIndex";
import { apiErrorMessages } from "@/lib/runRequest";
import type { Stats } from "@/lib/types";

const POLL_MS = 10_000;

export default function ResultsPage() {
  return DEMO_MODE ? <DemoResults /> : <LiveResults />;
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-ochre-800 bg-ochre-950 px-4 py-3 text-ochre-200"
    >
      {children}
    </div>
  );
}

/** The API's /stats, polled every 10 s. */
function LiveResults() {
  const [includeReplay, setIncludeReplay] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStats(includeReplay)
        .then((s) => {
          if (cancelled) return;
          setStats(s);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(apiErrorMessages(err)[0]);
        });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [includeReplay]);

  return (
    <main className="animate-rise space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="kicker">Scoreboard</p>
          <h1 className="mt-3 font-display text-5xl tracking-tight text-ink-50 sm:text-6xl">
            Results
          </h1>
          <p className="mt-3 max-w-xl text-ink-300">
            Every run today: what failed, what we fixed, where we stopped honestly, and what it
            cost. Refreshes every 10 s.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            className="accent-moss-400"
            type="checkbox"
            checked={includeReplay}
            onChange={(e) => setIncludeReplay(e.target.checked)}
          />
          Include recorded (replay) runs
        </label>
      </div>

      {error && (
        <ErrorBanner>
          Can&apos;t load results: {error}
          {stats ? " Showing the last numbers we got." : ""}
        </ErrorBanner>
      )}

      <StatsTiles stats={stats} />
      <section className="space-y-4">
        <h2 className="font-display text-3xl text-ink-50">Runs</h2>
        {stats ? (
          <ResultsTable rows={stats.rows ?? []} />
        ) : (
          <p className="animate-pulse text-ink-400">{error ? "No data." : "Loading…"}</p>
        )}
      </section>
    </main>
  );
}

/** Static demo: the same numbers, computed in the browser from the bundled runs. */
function DemoResults() {
  const [runs, setRuns] = useState<DemoRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex()
      .then((index) => {
        if (!cancelled) setRuns(index.runs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = runs ? demoStats(runs) : null;
  const samples = runs?.filter((r) => r.kind === "sample").length ?? 0;
  const recordings = runs?.filter((r) => r.kind === "recording").length ?? 0;
  const kindOf = new Map(runs?.map((r) => [r.id, r.kind]) ?? []);

  return (
    <main className="animate-rise space-y-10">
      <div>
        <p className="kicker">Scoreboard · bundled runs</p>
        <h1 className="mt-3 font-display text-5xl tracking-tight text-ink-50 sm:text-6xl">
          Results
        </h1>
        <p className="mt-3 max-w-xl text-ink-300">
          Computed in your browser from the runs bundled with this demo deployment, with the same
          definitions as the live results page. These are not live results.
        </p>
        {runs && (
          <p className="mt-2 font-mono text-xs text-ink-400">
            {recordings} recorded run{recordings === 1 ? "" : "s"}
            {samples > 0 &&
              ` + ${samples} hand-written illustrative sample${samples === 1 ? "" : "s"}`}
            .
          </p>
        )}
      </div>

      {error && <ErrorBanner>Can&apos;t load the bundled runs: {error}</ErrorBanner>}

      <StatsTiles stats={stats} />
      <section className="space-y-4">
        <h2 className="font-display text-3xl text-ink-50">Bundled runs</h2>
        {stats ? (
          <ResultsTable
            rows={stats.rows}
            emptyText="No runs are bundled with this deployment."
            rowNote={(row) => {
              const id = demoIdFromRunId(row.run_id);
              return id && kindOf.get(id) === "sample"
                ? "illustrative sample · hand-written, not a live run"
                : null;
            }}
          />
        ) : (
          <p className="animate-pulse text-ink-400">{error ? "No data." : "Loading…"}</p>
        )}
      </section>
    </main>
  );
}
