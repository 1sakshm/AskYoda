import { CLASS_COLOR, CLASS_LABEL } from "@/lib/format";
import { patchChips } from "@/lib/patchDiff";
import type { AttemptConfig, Diagnosis, DiagnosisSource, EvidenceSource, Rung } from "@/lib/types";

const SOURCE_LABEL: Record<DiagnosisSource, string> = {
  rules: "rules",
  llm: "Claude",
  rules_fallback: "rules fallback",
};

const EVIDENCE_LABEL: Record<EvidenceSource, string> = {
  trace: "trace",
  result: "result",
  fetch_text: "page text",
  verifier: "verifier",
  tinyfish_error: "TinyFish error",
};

interface Props {
  diagnosis: Diagnosis;
  /** Scroll the timeline to a trace event of this attempt. */
  onJumpToStep?: (seq: number) => void;
  /** Step number of the failing event, when it is a progress step. */
  failingStepNo?: number | null;
  /** Rung the diagnosed attempt ran on (for the patch diff). */
  rung: Rung;
  /** Config of the attempt this patch produced, once it has started. */
  nextConfig?: AttemptConfig | null;
}

function AddedLine({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-moss-800/70 bg-moss-950 px-3 py-1.5 font-mono text-xs text-moss-200">
      <span aria-hidden className="select-none text-moss-400">
        +
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

export default function DiagnosisCard({
  diagnosis: d,
  onJumpToStep,
  failingStepNo,
  rung,
  nextConfig,
}: Props) {
  const { patch } = d;
  const chips = patchChips(patch, rung, nextConfig);
  return (
    <section className="space-y-4 rounded-xl border border-ink-600 bg-ink-850 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="kicker mr-1">Diagnosis</span>
        <span className={`rounded-full px-2.5 py-0.5 font-medium ${CLASS_COLOR[d.failure_class]}`}>
          {CLASS_LABEL[d.failure_class]}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 ${
            d.recoverable
              ? "bg-moss-400/10 text-moss-300 ring-1 ring-moss-400/30"
              : "bg-ember-400/10 text-ember-300 ring-1 ring-ember-400/30"
          }`}
        >
          {d.recoverable ? "recoverable" : "unrecoverable"}
        </span>
        <span className="font-mono text-ink-400">{Math.round(d.confidence * 100)}% confident</span>
        <span className="rounded-full border border-ink-600 px-2.5 py-0.5 font-mono text-ink-300">
          {SOURCE_LABEL[d.source]}
        </span>
      </div>

      <p className="font-display text-xl leading-snug text-ink-50">{d.explanation}</p>

      {d.failing_step_seq !== null && d.failing_step_label && (
        <button
          type="button"
          onClick={() => onJumpToStep?.(d.failing_step_seq as number)}
          className="block text-left text-sm text-ember-300 underline decoration-ember-500/50 underline-offset-4 hover:text-ember-200"
        >
          Failing step{failingStepNo ? ` ${failingStepNo}` : ""}: {d.failing_step_label}
        </button>
      )}

      {d.evidence.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="kicker">Evidence</h4>
          {d.evidence.map((e, i) => (
            <blockquote
              key={i}
              className="break-words border-l-2 border-ink-500 pl-3 font-mono text-xs leading-relaxed text-ink-200"
            >
              <span className="kicker mr-2">{EVIDENCE_LABEL[e.source]}</span>
              {e.event_seq !== null && onJumpToStep ? (
                <button
                  type="button"
                  onClick={() => onJumpToStep(e.event_seq as number)}
                  title="Show this step in the timeline"
                  className="text-left underline decoration-ink-500 decoration-dotted underline-offset-4 hover:text-ink-50"
                >
                  “{e.quote}”
                </button>
              ) : (
                <>“{e.quote}”</>
              )}
            </blockquote>
          ))}
        </div>
      )}

      {patch.stop ? (
        <div className="rounded-lg border border-ember-500/40 bg-ember-950 p-3 text-sm text-ember-100">
          <span className="font-semibold">Stop: </span>
          {patch.stop_reason}
        </div>
      ) : (
        <div className="space-y-2">
          <h4 className="kicker">Next attempt</h4>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-moss-400/10 px-2.5 py-0.5 text-xs font-medium text-moss-300 ring-1 ring-moss-400/30"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
          {patch.goal_prefix && <AddedLine text={patch.goal_prefix} />}
          {patch.goal_suffix && <AddedLine text={patch.goal_suffix} />}
          {patch.output_schema && (
            <details className="rounded-lg border border-ink-700 px-3 py-2">
              <summary className="cursor-pointer text-sm text-ink-300">
                Tighter output schema
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs text-ink-300">
                {JSON.stringify(patch.output_schema, null, 2)}
              </pre>
            </details>
          )}
          {patch.summary.length > 0 && (
            <ul className="list-inside list-disc text-sm text-ink-200">
              {patch.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
