"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AloneComparison from "@/components/AloneComparison";
import { createRun, getSites } from "@/lib/api";
import { demoRunId, loadDemoIndex, needsHuman, type DemoRun } from "@/lib/demoIndex";
import { CLASS_COLOR, CLASS_LABEL, RUNG_LABEL } from "@/lib/format";
import { apiErrorMessages } from "@/lib/runRequest";
import { groupScenarios, scenarioRequest, type ScenarioGroups } from "@/lib/scenarios";
import type { SiteInfo } from "@/lib/types";

interface CardProps {
  site: SiteInfo;
  /** The bundled recording of this site, when there is one. */
  recording: DemoRun | null;
  starting: string | null;
  error: string | undefined;
  onRun: (site: SiteInfo) => void;
}

function ScenarioCard({ site, recording, starting, error, onRun }: CardProps) {
  const lab = site.kind === "lab";
  const busy = starting === site.id;
  const human = needsHuman(site.id, site.expected_class);
  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-900/80 p-6 transition-colors hover:border-ink-500 hover:bg-ink-850">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">{lab ? "Test page" : "Real website"}</span>
        {human ? (
          <span className="rounded-full bg-ember-400/10 px-2.5 py-0.5 text-xs text-ember-300 ring-1 ring-ember-400/35">
            Needs human escalation
          </span>
        ) : (
          site.expected_class && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs ${CLASS_COLOR[site.expected_class]}`}
            >
              {CLASS_LABEL[site.expected_class]}
            </span>
          )
        )}
      </div>
      <h4 className="font-display text-2xl leading-tight text-ink-50">{site.title}</h4>
      {site.summary && <p className="text-sm leading-relaxed text-ink-300">{site.summary}</p>}
      <p className="font-mono text-xs text-ink-400">
        starts at {RUNG_LABEL[site.start_rung ?? "fetch"].toLowerCase()}
        {site.cost_hint && ` · ${site.cost_hint}`}
      </p>
      {recording && <AloneComparison run={recording} />}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-ember-500/40 bg-ember-950/70 px-3 py-2 text-sm text-ember-200"
        >
          {error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-ink-700/70 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {recording && (
            <Link
              href={`/runs/${demoRunId(recording.id)}`}
              className="btn-primary px-4 py-2 text-sm"
              title="Plays the recorded run instantly, free"
            >
              Watch recording ▸
            </Link>
          )}
          <button
            type="button"
            disabled={starting !== null}
            onClick={() => onRun(site)}
            className={recording ? "btn-ghost px-4 py-2 text-sm" : "btn-primary px-4 py-2 text-sm"}
          >
            {busy ? "Starting…" : "Run live"}
            {!busy && <span aria-hidden>→</span>}
          </button>
        </div>
        <a
          href={site.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-ink-300 transition-colors hover:text-ink-50"
        >
          View page ↗
        </a>
      </div>
    </article>
  );
}

/**
 * One-click live runs on sites prepared in advance (fixtures/sites.yaml entries with a title):
 * our own test pages built to fail, then real websites. Each click spends the shared budget.
 */
export default function ScenarioCards() {
  const router = useRouter();
  const [groups, setGroups] = useState<ScenarioGroups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recordings, setRecordings] = useState<Map<string, DemoRun>>(new Map());

  // Recordings are optional extras: a missing or broken index just means no "Watch" buttons.
  useEffect(() => {
    let cancelled = false;
    loadDemoIndex()
      .then((index) => {
        if (cancelled) return;
        const runs = index.runs.filter((r) => r.kind === "recording");
        setRecordings(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSites()
      .then((sites) => {
        if (!cancelled) setGroups(groupScenarios(Array.isArray(sites) ? sites : []));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(apiErrorMessages(err)[0] ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(site: SiteInfo) {
    const built = scenarioRequest(site);
    if (!built.ok) {
      setErrors({ [site.id]: built.errors.join(" ") });
      return;
    }
    setStarting(site.id);
    setErrors({});
    try {
      const created = await createRun(built.request);
      router.push(`/runs/${encodeURIComponent(created.run_id)}`);
    } catch (err) {
      setErrors({ [site.id]: apiErrorMessages(err).join(" ") });
      setStarting(null);
    }
  }

  if (loadError) {
    return (
      <p className="panel px-5 py-4 text-ochre-200">Prepared cases are unavailable: {loadError}</p>
    );
  }
  if (!groups) return <p className="animate-pulse text-ink-400">Loading prepared cases…</p>;
  if (groups.lab.length === 0 && groups.real.length === 0) return null;

  const sections = [
    {
      key: "lab",
      title: "Test pages built to fail",
      blurb:
        "Our own pages, each built to trip one failure on purpose. All data on them is fictional.",
      sites: groups.lab,
    },
    {
      key: "real",
      title: "Real websites",
      blurb:
        "Public sites (scraping sandboxes where possible) with the same failures in the wild. Less predictable: real sites change.",
      sites: groups.real,
    },
  ].filter((s) => s.sites.length > 0);

  return (
    <section id="scenarios" className="scroll-mt-24 space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">One click, real run</p>
          <h2 className="mt-2 font-display text-4xl tracking-tight text-ink-50">Prepared cases</h2>
        </div>
        <p className="max-w-md text-ink-300">
          Each starts a live run on a page prepared in advance. It calls TinyFish for real, so it
          spends the shared budget.
        </p>
      </div>
      {sections.map((section) => (
        <div key={section.key} className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-ink-700/70 pb-3">
            <h3 className="text-lg font-medium text-ink-50">{section.title}</h3>
            <p className="text-sm text-ink-400">{section.blurb}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.sites.map((site) => (
              <ScenarioCard
                key={site.id}
                site={site}
                recording={recordings.get(site.id) ?? null}
                starting={starting}
                error={errors[site.id]}
                onRun={run}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
