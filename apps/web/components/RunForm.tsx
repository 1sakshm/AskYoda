"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, createRun, getSites } from "@/lib/api";
import { CLASS_LABEL, RUNG_LABEL, RUNG_ORDER } from "@/lib/format";
import {
  apiErrorMessages,
  buildRunRequest,
  emptyRunForm,
  siteToForm,
  type RunFormState,
} from "@/lib/runRequest";
import type { ExpectedCheckType, SiteInfo } from "@/lib/types";

const CUSTOM = "__custom__";
const LAST_SITE_KEY = "afa.lastSite";

// localStorage can be missing or throw (private windows, blocked storage): never let it break the form.
function readLastSite(): string | null {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function writeLastSite(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(LAST_SITE_KEY, id);
    else window.localStorage.removeItem(LAST_SITE_KEY);
  } catch {
    // Remembering the site is a convenience only.
  }
}

const EXPECTED_TYPES: { value: ExpectedCheckType | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "contains", label: "Result contains text" },
  { value: "regex", label: "Result matches a regex" },
  { value: "fields_present", label: "Fields are present" },
  { value: "min_items", label: "List has at least N items" },
];

const inputClass = "field";
const labelClass = "kicker block";

interface RunFormProps {
  /** When set, the form is shown disabled with this note (e.g. in the static demo). */
  disabledNote?: string;
}

export default function RunForm({ disabledNote }: RunFormProps = {}) {
  const disabled = Boolean(disabledNote);
  const router = useRouter();
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [form, setForm] = useState<RunFormState>(emptyRunForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (disabled) return; // no API to ask in the static demo
    let cancelled = false;
    getSites()
      .then((list) => {
        if (cancelled) return;
        setSites(Array.isArray(list) ? list : []);
        const remembered = (Array.isArray(list) ? list : []).find((s) => s.id === readLastSite());
        if (remembered) setForm((f) => (f.siteId || f.url ? f : siteToForm(remembered, f)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setSitesError(apiErrorMessages(err)[0]);
      });
    return () => {
      cancelled = true;
    };
  }, [disabled]);

  const site = sites.find((s) => s.id === form.siteId) ?? null;
  const update = (patch: Partial<RunFormState>) => setForm((f) => ({ ...f, ...patch }));

  function chooseSite(id: string) {
    const chosen = sites.find((s) => s.id === id);
    writeLastSite(chosen ? chosen.id : null);
    if (chosen) setForm((f) => siteToForm(chosen, f));
    else update({ siteId: null });
  }

  async function submit(mode = form.mode) {
    if (disabled) return;
    const built = buildRunRequest({ ...form, mode });
    if (!built.ok) {
      setErrors(built.errors);
      setStatus(null);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    setStatus(null);
    try {
      const created = await createRun(built.request);
      router.push(`/runs/${encodeURIComponent(created.run_id)}`);
    } catch (err) {
      setErrors(apiErrorMessages(err));
      setStatus(err instanceof ApiError ? err.status : null);
      setSubmitting(false);
    }
  }

  const canReplay = Boolean(site?.has_trace);

  return (
    <form
      className="panel space-y-6 p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {disabledNote && (
        <p className="rounded-lg border border-ink-600 bg-ink-850 px-4 py-3 text-ink-200">
          {disabledNote}
        </p>
      )}
      <fieldset disabled={disabled} className="min-w-0 space-y-6 disabled:opacity-60">
        <div className="space-y-1.5">
          <label htmlFor="site" className={labelClass}>
            Demo site
          </label>
          <select
            id="site"
            className={inputClass}
            value={form.siteId ?? CUSTOM}
            onChange={(e) => chooseSite(e.target.value)}
          >
            <option value={CUSTOM}>Custom URL…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
                {s.expected_class ? ` · shows ${CLASS_LABEL[s.expected_class]}` : ""}
                {s.has_trace ? " · ● recorded" : ""}
              </option>
            ))}
          </select>
          {sitesError && (
            <p className="text-sm text-ochre-300">Demo sites unavailable: {sitesError}</p>
          )}
          {site && (
            <p className="text-sm text-ink-300">
              {site.expected_class ? `Shows ${CLASS_LABEL[site.expected_class]}` : "Demo site"}
              {site.has_trace ? (
                <span className="text-ochre-300"> · ● recorded trace available</span>
              ) : (
                <span className="text-ink-400"> · not recorded yet</span>
              )}
            </p>
          )}
          {site?.notes && <p className="text-sm text-ink-400">{site.notes}</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="url" className={labelClass}>
            URL
          </label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://example.com/products"
            className={inputClass}
            value={form.url}
            onChange={(e) => update({ url: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="goal" className={labelClass}>
            Goal
          </label>
          <textarea
            id="goal"
            required
            rows={3}
            placeholder="List the first 3 products with their name and price."
            className={inputClass}
            value={form.goal}
            onChange={(e) => update({ goal: e.target.value })}
          />
        </div>

        <fieldset className="space-y-3 rounded-xl border border-ink-700 p-5">
          <legend className="kicker px-2">Expected-output check</legend>
          <select
            aria-label="Expected check type"
            className={inputClass}
            value={form.expectedType}
            onChange={(e) => update({ expectedType: e.target.value as ExpectedCheckType | "" })}
          >
            {EXPECTED_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {(form.expectedType === "contains" || form.expectedType === "regex") && (
            <input
              aria-label={form.expectedType === "regex" ? "Regex" : "Text"}
              placeholder={form.expectedType === "regex" ? "\\b22\\b" : "Blue Mug"}
              className={`${inputClass} font-mono`}
              value={form.expectedValue}
              onChange={(e) => update({ expectedValue: e.target.value })}
            />
          )}
          {form.expectedType === "fields_present" && (
            <input
              aria-label="Field paths"
              placeholder="title, price.amount, products.0.name"
              className={`${inputClass} font-mono`}
              value={form.expectedFields}
              onChange={(e) => update({ expectedFields: e.target.value })}
            />
          )}
          {form.expectedType === "min_items" && (
            <div className="flex gap-2">
              <input
                aria-label="List path"
                placeholder="products"
                className={`${inputClass} font-mono`}
                value={form.expectedPath}
                onChange={(e) => update({ expectedPath: e.target.value })}
              />
              <input
                aria-label="Minimum items"
                type="number"
                min={1}
                placeholder="3"
                className={`${inputClass} w-32`}
                value={form.expectedMin}
                onChange={(e) => update({ expectedMin: e.target.value })}
              />
            </div>
          )}
          {!form.expectedType && (
            <p className="text-sm text-ochre-300/90">
              Without an expected check the verifier can only catch empty, null, blocked or
              self-reported failures.
            </p>
          )}
        </fieldset>

        <details className="group rounded-xl border border-ink-700 p-5">
          <summary className="kicker cursor-pointer list-none select-none hover:text-ink-200">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>
            Advanced
          </summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="schema" className={labelClass}>
                TinyFish output schema (JSON, optional)
              </label>
              <textarea
                id="schema"
                rows={5}
                placeholder='{"type": "object", "properties": {"title": {"type": "string"}}}'
                className={`${inputClass} font-mono text-sm`}
                value={form.outputSchema}
                onChange={(e) => update({ outputSchema: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="start-rung" className={labelClass}>
                  Start rung
                </label>
                <select
                  id="start-rung"
                  className={inputClass}
                  value={form.startRung}
                  onChange={(e) =>
                    update({ startRung: e.target.value as RunFormState["startRung"] })
                  }
                >
                  {RUNG_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {RUNG_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="max-attempts" className={labelClass}>
                  Max attempts
                </label>
                <input
                  id="max-attempts"
                  type="number"
                  min={1}
                  max={8}
                  placeholder="4"
                  className={inputClass}
                  value={form.maxAttempts}
                  onChange={(e) => update({ maxAttempts: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="max-credits" className={labelClass}>
                  Max credits
                </label>
                <input
                  id="max-credits"
                  type="number"
                  min={0}
                  max={500}
                  placeholder="40"
                  className={inputClass}
                  value={form.maxCredits}
                  onChange={(e) => update({ maxCredits: e.target.value })}
                />
              </div>
            </div>
          </div>
        </details>

        <fieldset className="flex flex-wrap items-center gap-6">
          <legend className="sr-only">Mode</legend>
          {(["live", "replay"] as const).map((mode) => (
            <label
              key={mode}
              className={`flex items-center gap-2 ${
                mode === "replay" && !canReplay ? "text-ink-500" : "text-ink-200"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={form.mode === mode}
                disabled={mode === "replay" && !canReplay}
                onChange={() => update({ mode })}
                className="accent-moss-400"
              />
              {mode === "live" ? "Live (calls TinyFish)" : "Replay recorded trace"}
            </label>
          ))}
        </fieldset>

        {errors.length > 0 && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-ember-500/40 bg-ember-950/70 p-4"
          >
            <ul className="list-inside list-disc text-sm text-ember-200">
              {errors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
            {status === 503 && canReplay && form.mode !== "replay" && (
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-sm"
                onClick={() => {
                  update({ mode: "replay" });
                  void submit("replay");
                }}
              >
                Switch to replay
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-700/70 pt-6">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Starting…" : form.mode === "replay" ? "Run replay" : "Start run"}
            {!submitting && <span aria-hidden>→</span>}
          </button>
          {canReplay && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                update({ mode: "replay" });
                void submit("replay");
              }}
              className="btn-ghost"
            >
              ▶ Replay recorded run
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
