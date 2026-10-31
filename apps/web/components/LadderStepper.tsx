import { RUNG_ORDER, fmtCredits } from "@/lib/format";
import type { RungState, RunViewState } from "@/lib/runState";
import type { Rung, RungChangeEvent } from "@/lib/types";

const TITLE: Record<Rung, string> = {
  fetch: "1 · Fetch",
  agent: "2 · Agent",
  agent_stealth: "3 · Agent + stealth + proxy",
};

const SUBTITLE: Record<Rung, string> = {
  fetch: "free, read-only",
  agent: "live browser",
  agent_stealth: "anti-bot browser + proxy",
};

const STATE_STYLE: Record<RungState, string> = {
  pending: "border-ink-700 bg-ink-900/60 text-ink-400",
  // The glow plays once (1.5 s) each time a rung becomes active.
  active: "border-moss-500 bg-moss-950 text-ink-50 animate-rung-flash",
  failed: "border-ember-500/70 bg-ember-950/80 text-ink-50",
  passed: "border-moss-400 bg-moss-900/70 text-ink-50",
  skipped: "border-dashed border-ink-700 bg-transparent text-ink-500",
};

const DOT: Record<RungState, string> = {
  pending: "bg-ink-600",
  active: "bg-moss-400 animate-pulse",
  failed: "bg-ember-400",
  passed: "bg-moss-400",
  skipped: "bg-ink-700",
};

const WORD_STYLE: Record<RungState, string> = {
  pending: "text-ink-500",
  active: "text-moss-300",
  failed: "text-ember-300",
  passed: "text-moss-300",
  skipped: "text-ink-500",
};

/** Why a rung was skipped: the reason of the rung change that skipped it. */
export function skipReason(rung: Rung, rungChanges: RungChangeEvent[]): string | null {
  const change = rungChanges.find((c) => c.skipped.includes(rung));
  return change ? change.reason : null;
}

const STATE_WORD: Record<RungState, string> = {
  pending: "not used",
  active: "running",
  failed: "failed",
  passed: "verified",
  skipped: "skipped",
};

interface Props {
  rungs: RunViewState["rungs"];
  rungChanges: RungChangeEvent[];
}

/** How far the run has climbed, 0–1, for the progress rail behind the rungs. */
export function climbProgress(rungs: RunViewState["rungs"]): number {
  let reached = -1;
  RUNG_ORDER.forEach((rung, i) => {
    if (rungs[rung].state !== "pending") reached = i;
  });
  return reached <= 0 ? 0 : reached / (RUNG_ORDER.length - 1);
}

export default function LadderStepper({ rungs, rungChanges }: Props) {
  const last = rungChanges[rungChanges.length - 1];
  const progress = climbProgress(rungs);
  const ended = RUNG_ORDER.some((r) => rungs[r].state === "passed");
  return (
    <div className="space-y-3">
      <ol className="grid gap-3 md:grid-cols-3">
        {RUNG_ORDER.map((rung) => {
          const view = rungs[rung];
          const skipped = view.state === "skipped";
          return (
            <li
              key={rung}
              className={`rounded-xl border px-4 py-3.5 transition-[background-color,border-color,color,opacity,transform] duration-500 ${
                view.state === "pending" ? "opacity-80" : "opacity-100"
              } ${view.state === "active" ? "-translate-y-0.5" : ""} ${STATE_STYLE[view.state]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`font-medium ${skipped ? "line-through" : ""}`}>
                  {TITLE[rung]}
                </span>
                <span
                  className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] ${WORD_STYLE[view.state]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[view.state]}`} aria-hidden />
                  {STATE_WORD[view.state]}
                </span>
              </div>
              {skipped ? (
                <div className="mt-1 text-sm">
                  skipped — {skipReason(rung, rungChanges) ?? "not needed"}
                </div>
              ) : (
                <div className="mt-1 font-mono text-xs text-ink-400">
                  {SUBTITLE[rung]} · {view.attempts.length} attempt
                  {view.attempts.length === 1 ? "" : "s"} · {fmtCredits(view.credits)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {/* How far the run has climbed: a rail with a marker under each rung (desktop). */}
      <div aria-hidden className="relative mx-[16.6%] hidden h-4 md:block">
        <div className="absolute inset-x-0 top-1/2 h-px bg-ink-700" />
        <div
          className={`absolute inset-x-0 top-1/2 h-px origin-left transition-transform duration-700 ease-out ${
            ended ? "bg-moss-400" : "bg-ochre-400"
          }`}
          style={{ transform: `scaleX(${progress})` }}
        />
        {RUNG_ORDER.map((rung, i) => (
          <span
            key={rung}
            className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-950 transition-colors duration-500 ${DOT[rungs[rung].state]}`}
            style={{ left: `${(i / (RUNG_ORDER.length - 1)) * 100}%` }}
          />
        ))}
      </div>
      {last && <p className="text-sm text-ink-400">{last.reason}</p>}
    </div>
  );
}
