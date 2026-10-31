"use client";

import { useEffect, useState } from "react";

import { latestScreenshotUrl, screenshotUrl } from "@/lib/api";
import type { AttemptView, RunViewState } from "@/lib/runState";
import type { RunMode } from "@/lib/types";

interface Props {
  liveView: RunViewState["liveView"];
  attempt: AttemptView | null;
  mode: RunMode | null;
  runId: string;
  /**
   * Where the failing-step screenshot of an attempt lives (null = there is none, show the
   * overlay without a request). Defaults to the API endpoint.
   */
  screenshotSrc?: (attemptNo: number) => string | null;
}

/** "Step k — label" for the attempt's failing step, else the verifier summary. */
export function failingCaption(attempt: AttemptView): string {
  const failing = attempt.events.find((e) => e.seq === attempt.failingSeq);
  if (!failing) return attempt.verify?.summary ?? "";
  return `${failing.step_no ? `Step ${failing.step_no}` : "Failing step"} — ${failing.label}`;
}

/** Hostnames on the reserved `.invalid` TLD come from the sample fixture, never TinyFish. */
export function isPlaceholderUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".invalid");
  } catch {
    return true;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {children}
    </div>
  );
}

function Message({ title, detail, pulse }: { title: string; detail?: string; pulse?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className={`text-lg font-medium text-slate-200 ${pulse ? "animate-pulse" : ""}`}>
        {title}
      </p>
      {detail && <p className="max-w-md text-sm text-slate-400">{detail}</p>}
    </div>
  );
}

/** The failing step's screenshot; falls back to an overlay when there is none. */
function FailingShot({ src, attempt }: { src: string | null; attempt: AttemptView }) {
  const [broken, setBroken] = useState(false);
  const caption = failingCaption(attempt);
  if (broken || !src) {
    return (
      <Frame>
        <Message title="Live view ended" detail={caption} />
      </Frame>
    );
  }
  return (
    <Frame>
      <figure className="h-full w-full">
        {/* A dynamic API image: next/image would need remotePatterns for no benefit here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Browser at the failing step: ${caption}`}
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
        <figcaption className="absolute inset-x-0 bottom-0 border-t border-rose-500/50 bg-slate-950/85 px-3 py-2 text-rose-100">
          {caption}
        </figcaption>
      </figure>
    </Frame>
  );
}

/**
 * The agent's newest step screenshot, fetched again on every step (`version`). The previous
 * image stays up until the next one has loaded, so it never flickers. TinyFish's live viewer
 * can take longer to connect than a short run lasts; this shows the browser from step one.
 */
function StepShots({
  runId,
  attemptNo,
  version,
  caption,
  waiting,
}: {
  runId: string;
  attemptNo: number;
  version: number;
  caption?: string;
  waiting: string;
}) {
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    const src = latestScreenshotUrl(runId, attemptNo, version);
    const img = new Image();
    img.onload = () => setShown(src);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [runId, attemptNo, version]);

  if (!shown) {
    return (
      <Frame>
        <Message title={waiting} pulse />
      </Frame>
    );
  }
  return (
    <Frame>
      <figure className="h-full w-full">
        {/* A dynamic API image: next/image would need remotePatterns for no benefit here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shown} alt="The agent's browser" className="h-full w-full object-contain" />
        {caption && (
          <figcaption className="absolute inset-x-0 bottom-0 border-t border-slate-700 bg-slate-950/85 px-3 py-2 text-slate-200">
            {caption}
          </figcaption>
        )}
      </figure>
    </Frame>
  );
}

function ViewToggle({ live, onToggle }: { live: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
    >
      {live ? "Show step screenshots (instant)" : "Watch TinyFish live stream (slower to connect)"}
    </button>
  );
}

export default function BrowserPanel({ liveView, attempt, mode, runId, screenshotSrc }: Props) {
  const [preferStream, setPreferStream] = useState(false);
  if (!attempt) {
    return (
      <Frame>
        <Message title="Waiting for the first attempt…" pulse />
      </Frame>
    );
  }

  if (attempt.rung === "fetch") {
    return (
      <Frame>
        <Message
          title="Rung 1 is a read-only fetch — no browser"
          detail="TinyFish Fetch returns the page text; we extract the answer from it for 0 credits."
        />
      </Frame>
    );
  }

  const view = liveView && liveView.attemptNo === attempt.attemptNo ? liveView : null;

  // After a diagnosed attempt ends, show where it failed (live and replay alike).
  if (attempt.diagnosis && !view?.active) {
    const src = screenshotSrc
      ? screenshotSrc(attempt.attemptNo)
      : screenshotUrl(runId, attempt.attemptNo);
    return <FailingShot key={`${runId}:${attempt.attemptNo}`} src={src} attempt={attempt} />;
  }

  // A real live run (not the static demo): step screenshots first, the stream on request.
  if (mode === "live" && !screenshotSrc) {
    const running = attempt.status === "running";
    const canStream = running && !!view?.active && !isPlaceholderUrl(view.url);
    const toggle = canStream ? (
      <ViewToggle live={preferStream} onToggle={() => setPreferStream((p) => !p)} />
    ) : null;
    if (canStream && preferStream && view) {
      return (
        <div>
          {toggle}
          <Frame>
            <iframe
              src={view.url}
              title={`Live browser for attempt ${attempt.attemptNo}`}
              className="h-full w-full"
              referrerPolicy="no-referrer"
              allow="fullscreen"
            />
          </Frame>
        </div>
      );
    }
    return (
      <div>
        {toggle}
        <StepShots
          key={`${runId}:${attempt.attemptNo}`}
          runId={runId}
          attemptNo={attempt.attemptNo}
          version={attempt.events.length}
          caption={running ? undefined : attempt.verify?.summary}
          waiting={
            running ? "Agent starting — first screenshot in a few seconds…" : "Loading last step…"
          }
        />
      </div>
    );
  }

  if (!view) {
    return (
      <Frame>
        {attempt.status === "running" ? (
          <Message
            title="Waiting for live view…"
            detail="TinyFish sends it a few seconds in."
            pulse
          />
        ) : (
          <Message title="No live view for this attempt" />
        )}
      </Frame>
    );
  }

  if (view.active) {
    if (mode === "replay" || isPlaceholderUrl(view.url)) {
      return (
        <Frame>
          <Message
            title={
              mode === "replay" ? "Recorded run — live view not available" : "Sample live view"
            }
            detail="The real run streams TinyFish's browser here."
          />
        </Frame>
      );
    }
    return (
      <Frame>
        <iframe
          src={view.url}
          title={`Live browser for attempt ${attempt.attemptNo}`}
          className="h-full w-full"
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <Message title="Live view ended" detail={attempt.verify?.summary} />
    </Frame>
  );
}
