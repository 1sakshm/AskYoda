import { CLASS_COLOR, CLASS_LABEL } from "@/lib/format";
import type { FailureClass, Stats } from "@/lib/types";

// Emphasis pair: our credits in the moss accent, the naive baseline in a de-emphasis ink.
// Values are always labelled in text, so the ink's low contrast never carries meaning alone.
const OURS = "bg-moss-400";
const BASELINE = "bg-ink-600";

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-ink-900 p-6">
      <div className="kicker">{label}</div>
      <div className="mt-3 font-display text-6xl leading-none text-ink-50">{value}</div>
      <div className="mt-3 text-sm text-ink-400">{hint}</div>
    </div>
  );
}

function CreditBar({
  label,
  value,
  max,
  fill,
}: {
  label: string;
  value: number;
  max: number;
  fill: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-4">
      <span className="text-sm text-ink-300">{label}</span>
      <div className="flex items-center gap-2" title={`${label}: ${value} credits (est.)`}>
        <div
          className={`h-3 shrink-0 rounded-full ${fill}`}
          style={{ width: `${Math.max(pct, value > 0 ? 1 : 0) * 0.85}%` }}
          role="img"
          aria-label={`${label}: ${value} credits`}
        />
        <span className="whitespace-nowrap font-mono text-sm text-ink-100">{value} cr</span>
      </div>
    </div>
  );
}

const show = (stats: Stats | null, pick: (s: Stats) => number) =>
  stats ? pick(stats).toLocaleString() : "—";

export default function StatsTiles({ stats }: { stats: Stats | null }) {
  const ours = stats?.credits_used_total ?? 0;
  const baseline = stats?.baseline_credits_total ?? 0;
  const max = Math.max(ours, baseline, 1);
  const classes = stats
    ? (Object.entries(stats.by_class ?? {}) as [FailureClass, number][]).filter(
        ([cls, n]) => n > 0 && cls in CLASS_LABEL,
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-700 bg-ink-700 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Diagnosed"
          value={show(stats, (s) => s.diagnosed)}
          hint="runs with at least one diagnosed failure"
        />
        <Tile
          label="Fixed"
          value={show(stats, (s) => s.fixed)}
          hint="verified after an automatic fix"
        />
        <Tile
          label="Honest stops"
          value={show(stats, (s) => s.unrecoverable)}
          hint="auth walls, captchas, still blocked on stealth"
        />
        <Tile
          label="Verified first try"
          value={show(stats, (s) => s.verified_first_try)}
          hint="no failure to diagnose"
        />
      </div>

      <div className="panel space-y-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="kicker">Credits saved vs the naive baseline</div>
            <div className="mt-3 font-display text-7xl leading-none text-moss-300">
              {stats ? `${stats.credits_saved.toLocaleString()} cr` : "—"}
            </div>
          </div>
          <div className="font-mono text-sm text-ink-400">
            {stats ? `${stats.runs_finished} finished of ${stats.runs_total} runs` : ""}
          </div>
        </div>
        <div className="space-y-3">
          <CreditBar label="Ours (est.)" value={ours} max={max} fill={OURS} />
          <CreditBar label="Naive baseline (est.)" value={baseline} max={max} fill={BASELINE} />
        </div>
        {classes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-700/70 pt-5 text-xs">
            <span className="kicker mr-1">Failures by class</span>
            {classes.map(([cls, n]) => (
              <span key={cls} className={`rounded-full px-2.5 py-0.5 ${CLASS_COLOR[cls]}`}>
                {CLASS_LABEL[cls]} · {n}
              </span>
            ))}
          </div>
        )}
        <p className="text-sm text-ink-400">
          Credits are estimated as 1 per agent step (TinyFish reports steps, not cost; Fetch is
          free). Naive baseline = always stealth + proxy, run 3 times.
        </p>
      </div>
    </div>
  );
}
