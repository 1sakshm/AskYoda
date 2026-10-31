"use client";

import { useState } from "react";

import RunView from "@/components/RunView";
import { DEMO_MODE, sampleStreamUrl } from "@/lib/api";
import { SAMPLE_NOTE, demoStreamUrl } from "@/lib/demoIndex";

export default function DevPage() {
  const [runKey, setRunKey] = useState(0);
  return (
    <main className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Illustrative</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-ink-50">Sample run</h1>
          <p className="mt-2 text-sm text-ink-400">
            {DEMO_MODE ? (
              <>
                Plays the bundled <code>/demo/runs/sample.jsonl</code> in your browser.
              </>
            ) : (
              <>
                Streams <code>fixtures/sample-run.jsonl</code> from <code>/dev/sample-stream</code>.
                No API keys needed.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRunKey((k) => k + 1)}
          className="btn-ghost px-4 py-1.5 text-sm"
        >
          Restart sample
        </button>
      </div>
      <RunView
        key={runKey}
        streamUrl={DEMO_MODE ? demoStreamUrl("sample") : sampleStreamUrl}
        mode="replay"
        runId="sample"
        badgeLabel="ILLUSTRATIVE SAMPLE"
        note={SAMPLE_NOTE}
        screenshotSrc={() => null}
        rawLog
      />
    </main>
  );
}
