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

export default function LadderStepper({ rungs, rungChanges }: Props) {
  const last = rungChanges[rungChanges.length - 1];
  return (
    <div className="space-y-3">
      <ol className="grid gap-3 md:grid-cols-3">
        {RUNG_ORDER.map((rung) => {
          const view = rungs[rung];
          const skipped = view.state === "skipped";
          return (
            <li
              key={rung}
              className={`rounded-xl border px-4 py-3.5 transition-colors ${STATE_STYLE[view.state]}`}
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
      {last && <p className="text-sm text-ink-400">{last.reason}</p>}
    </div>
  );
}
