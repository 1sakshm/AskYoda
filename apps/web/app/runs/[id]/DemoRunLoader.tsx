"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import RunView from "@/components/RunView";
import {
  SAMPLE_NOTE,
  demoRunId,
  demoScreenshotUrl,
  demoStreamUrl,
  demoVideoUrl,
  loadDemoIndex,
  loadVideoTimings,
  type DemoRun,
} from "@/lib/demoIndex";
import { videoGate, type VideoTiming } from "@/lib/videoClock";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; run: DemoRun; timings: Map<number, VideoTiming> }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function BackLink() {
  return (
    <Link href="/" className="link">
      Back to the bundled runs
    </Link>
  );
}

/** A bundled run (`/runs/demo-<id>`), played in the browser without any API call. */
export default function DemoRunLoader({ demoId }: { demoId: string }) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadDemoIndex()
      .then(async (index) => {
        const run = index.runs.find((r) => r.id === demoId);
        const timings = run ? await loadVideoTimings(run) : new Map<number, VideoTiming>();
        if (cancelled) return;
        setLoad(run ? { kind: "ready", run, timings } : { kind: "missing" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [demoId]);

  const ready = load.kind === "ready" ? load : null;
  // One stable gate per run: the playback effect restarts when it changes.
  const gate = useMemo(
    () =>
      ready && ready.timings.size > 0
        ? videoGate(demoRunId(ready.run.id), ready.timings)
        : undefined,
    [ready],
  );

  if (load.kind === "loading") return <p className="animate-pulse text-ink-400">Loading run…</p>;
  if (load.kind === "missing") {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-tight text-ink-50">
          No bundled run called “{demoId}”
        </h1>
        <BackLink />
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div className="space-y-2">
        <p className="text-ember-300">Can&apos;t load the bundled runs: {load.message}</p>
        <BackLink />
      </div>
    );
  }

  const { run } = load;
  const sample = run.kind === "sample";
  return (
    <RunView
      streamUrl={demoStreamUrl(run.id)}
      mode="replay"
      runId={demoRunId(run.id)}
      header={run.url && run.goal ? { url: run.url, goal: run.goal } : null}
      badgeLabel={sample ? "ILLUSTRATIVE SAMPLE" : undefined}
      note={sample ? SAMPLE_NOTE : undefined}
      screenshotSrc={(n) =>
        run.screenshot_attempts.includes(n) ? demoScreenshotUrl(run.id, n) : null
      }
      videoSrc={(n) => ((run.video_attempts ?? []).includes(n) ? demoVideoUrl(run.id, n) : null)}
      gate={gate}
    />
  );
}

/** Any non-bundled run id on the static demo deployment. */
export function DemoOnlyNotice() {
  return (
    <div className="space-y-2">
      <h1 className="font-display text-4xl tracking-tight text-ink-50">
        Only bundled runs are available here
      </h1>
      <p className="text-ink-300">
        This is the static demo deployment: it replays bundled runs in your browser. Live runs need
        the API, which isn&apos;t part of this deployment.
      </p>
      <BackLink />
    </div>
  );
}
