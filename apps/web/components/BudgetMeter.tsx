import type { BudgetEvent } from "@/lib/types";

function barColor(ratio: number): string {
  if (ratio >= 1) return "bg-ember-400";
  if (ratio >= 0.75) return "bg-ochre-400";
  return "bg-moss-400";
}

function Bar({ label, used, max }: { label: string; used: number; max: number }) {
  const ratio = max > 0 ? used / max : 1;
  return (
    <div className="w-40">
      <div className="flex items-baseline justify-between">
        <span className="kicker">{label}</span>
        <span className="font-mono text-sm text-ink-100">
          {used}
          <span className="text-ink-500">/{max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${barColor(ratio)}`}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function BudgetMeter({ budget }: { budget: BudgetEvent | null }) {
  if (!budget) return null;
  return (
    <div className="flex gap-6" aria-label="Budget">
      <Bar label="attempts" used={budget.attempts_used} max={budget.max_attempts} />
      <Bar label="credits" used={budget.credits_used} max={budget.max_credits} />
    </div>
  );
}
