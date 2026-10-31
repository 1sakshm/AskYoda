import { STATUS_LABEL, STATUS_STYLE, fmtCredits } from "@/lib/format";
import type { RunStatus, VerdictEvent } from "@/lib/types";

const CARD_STYLE: Partial<Record<RunStatus, string>> = {
  verified: "border-moss-500/60 bg-moss-950",
  unrecoverable: "border-ember-500/50 bg-ember-950",
  budget_exhausted: "border-ochre-500/50 bg-ochre-950",
  error: "border-dashed border-ember-500/50 bg-ink-900",
  cancelled: "border-ink-600 bg-ink-900",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div className="mt-1 font-mono text-lg text-ink-50">{value}</div>
    </div>
  );
}

export default function VerdictCard({ verdict }: { verdict: VerdictEvent | null }) {
  if (!verdict) return null;
  const baseline = verdict.baseline_credits_estimate;
  const saved = baseline !== null ? baseline - verdict.credits_used : null;
  return (
    <section
      className={`animate-rise space-y-5 rounded-2xl border p-6 ${CARD_STYLE[verdict.status] ?? "border-ink-700 bg-ink-900"}`}
    >
      <div>
        <p className="kicker">Verdict</p>
        <div
          className={`mt-2 font-display text-5xl tracking-tight sm:text-6xl ${STATUS_STYLE[verdict.status]}`}
        >
          {STATUS_LABEL[verdict.status].toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        </div>
      </div>
      <p className="text-lg leading-relaxed text-ink-100">{verdict.reason}</p>
      <div className="grid grid-cols-2 gap-6 border-t border-ink-50/10 pt-5 sm:grid-cols-4">
        <Stat label="Attempts" value={String(verdict.attempts_used)} />
        <Stat label="Credits used" value={fmtCredits(verdict.credits_used)} />
        {baseline !== null && <Stat label="Naive baseline" value={fmtCredits(baseline)} />}
        {saved !== null && saved > 0 && <Stat label="Saved" value={fmtCredits(saved)} />}
      </div>
      {verdict.final_result && (
        <div>
          <p className="kicker mb-2">Result</p>
          <pre className="max-h-64 overflow-auto rounded-xl border border-ink-700 bg-ink-950 p-4 font-mono text-sm text-ink-100">
            {JSON.stringify(verdict.final_result, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
