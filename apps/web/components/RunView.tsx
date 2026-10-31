"use client";

import { useState } from "react";

import BrowserPanel from "@/components/BrowserPanel";
import BudgetMeter from "@/components/BudgetMeter";
import LadderStepper from "@/components/LadderStepper";
import TraceTimeline from "@/components/TraceTimeline";
import VerdictCard from "@/components/VerdictCard";
import { apiErrorMessages } from "@/lib/runRequest";
import { useRunStream } from "@/lib/useRunStream";
import type { RunMode } from "@/lib/types";

interface Props {
  streamUrl: string;
  mode: RunMode | null;
  runId: string;
  /** Known before the stream starts (from GET /runs/{id}); the stream fills it in otherwise. */
  header?: { url: string; goal: string } | null;
  /** Show a collapsible log of every UI event (used by /dev). */
  rawLog?: boolean;
  /** Live run with a recorded trace: cancel it and open the replay (shown until the verdict). */
  onSwitchToReplay?: () => Promise<void>;
  /** Replaces the mode badge text (e.g. for the hand-written illustrative sample). */
  badgeLabel?: string;
  /** A visible note under the badge (e.g. "Hand-written example … not a live TinyFish run"). */
  note?: string;
  /** Screenshot source for BrowserPanel (bundled files in the static demo). */
  screenshotSrc?: (attemptNo: number) => string | null;
}

function ModeBadge({ mode, label }: { mode: RunMode | null; label?: string }) {
  if (!mode) return null;
  if (label) {
    return (
      <span className="rounded-full border border-ochre-800 bg-ochre-950 px-3 py-1 font-mono text-xs tracking-wide text-ochre-200">
        {label}
      </span>
    );
  }
  return mode === "live" ? (
    <span className="flex items-center gap-2 rounded-full border border-moss-800 bg-moss-950 px-3 py-1 font-mono text-xs tracking-wide text-moss-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss-400" aria-hidden />
      LIVE
    </span>
  ) : (
    <span className="rounded-full border border-ochre-800 bg-ochre-950 px-3 py-1 font-mono text-xs tracking-wide text-ochre-200">
      REPLAY · recorded trace
    </span>
  );
}

export default function RunView({
  streamUrl,
  mode,
  runId,
  header,
  rawLog = false,
  onSwitchToReplay,
  badgeLabel,
  note,
  screenshotSrc,
}: Props) {
  const { state, events, connected, error } = useRunStream(streamUrl);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const shown = header ?? state.header;
  const current = state.attempts.find((a) => a.attemptNo === state.currentAttempt) ?? null;

  async function switchToReplay() {
    if (!onSwitchToReplay) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await onSwitchToReplay();
    } catch (err) {
      setSwitchError(apiErrorMessages(err)[0]);
      setSwitching(false);
    }
  }

  return (
    <div className="animate-rise space-y-6" data-run-id={runId}>
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-700/70 pb-6">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ModeBadge mode={mode} label={badgeLabel} />
            {!connected && !state.done && (
              <span className="rounded-full border border-ink-700 px-3 py-1 font-mono text-xs text-ink-300">
                {state.lastSeq ? "Reconnecting…" : "Connecting…"}
              </span>
            )}
            {error && <span className="text-sm text-ember-300">{error}</span>}
          </div>
          {note && (
            <p className="rounded-lg border border-ochre-800/60 bg-ochre-950/60 px-3 py-2 text-sm text-ochre-200">
              {note}
            </p>
          )}
          <h1 className="break-words font-display text-3xl leading-tight tracking-tight text-ink-50 sm:text-4xl">
            {shown?.goal ?? "…"}
          </h1>
          <p className="truncate font-mono text-sm text-ink-400" title={shown?.url}>
            {shown?.url ?? "…"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <BudgetMeter budget={state.budget} />
          {onSwitchToReplay && !state.done && (
            <button
              type="button"
              onClick={() => void switchToReplay()}
              disabled={switching}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              {switching ? "Switching…" : "Switch to replay"}
            </button>
          )}
          {switchError && <span className="text-sm text-ember-300">{switchError}</span>}
        </div>
      </div>

      <LadderStepper rungs={state.rungs} rungChanges={state.rungChanges} />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <BrowserPanel
            liveView={state.liveView}
            attempt={current}
            mode={mode}
            runId={runId}
            screenshotSrc={screenshotSrc}
          />
          {state.done && <VerdictCard verdict={state.verdict} />}
        </div>
        <div className="min-w-0 lg:col-span-5">
          <TraceTimeline attempts={state.attempts} />
        </div>
      </div>

      {rawLog && (
        <details className="panel p-4">
          <summary className="kicker cursor-pointer hover:text-ink-200">
            Raw UI events ({events.length})
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto font-mono text-xs text-ink-400">
            {events.map((ev) => JSON.stringify(ev)).join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
