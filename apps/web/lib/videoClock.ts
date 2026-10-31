import type { UiEvent } from "./types";

/**
 * Recorded runs carry a video of TinyFish's browser per agent attempt (attempt-<n>.mp4) and a
 * time map from wall-clock time to video time (still stretches are cut short in the video). During
 * playback the video drives the timeline: an event of that attempt is shown once the video reaches
 * the moment it happened.
 */
export interface VideoTiming {
  /** [unix seconds, video seconds], ascending. */
  knots: [number, number][];
  duration: number;
}

/** Recorded videos play faster than real time; the panel says so. */
export const VIDEO_RATE = 2;

/** Video seconds at a wall-clock time: linear between knots, a still stretch maps to its cut. */
export function videoTimeAt(timing: VideoTiming, unixSeconds: number): number {
  const { knots } = timing;
  if (knots.length === 0) return 0;
  if (unixSeconds <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [t1, v1] = knots[i];
    if (unixSeconds <= t1) {
      const [t0, v0] = knots[i - 1];
      const span = t1 - t0;
      return span > 0 ? v0 + ((v1 - v0) * (unixSeconds - t0)) / span : v1;
    }
  }
  return knots[knots.length - 1][1];
}

const videos = new Map<string, HTMLVideoElement>();
/** Videos that failed to play: playback stops waiting on them. */
const stalled = new Set<string>();

export const videoKey = (runId: string, attemptNo: number) => `${runId}:${attemptNo}`;

export function registerVideo(key: string, el: HTMLVideoElement | null): void {
  if (el) {
    videos.set(key, el);
    stalled.delete(key);
  } else videos.delete(key);
}

const POLL_MS = 100;
/** Without a playing video (blocked, missing, failed), playback moves on after this. */
const NO_VIDEO_MS = 2500;
const HARD_LIMIT_MS = 30000;

/** Resolves once the registered video reaches `time` (or ends, fails, or never shows up). */
export function waitForVideo(key: string, time: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const giveUp = () => {
      stalled.add(key);
      resolve();
    };
    const tick = () => {
      if (stalled.has(key)) return resolve();
      const el = videos.get(key);
      const waited = Date.now() - started;
      if (waited > HARD_LIMIT_MS) return giveUp();
      if (!el) return waited > NO_VIDEO_MS ? giveUp() : void setTimeout(tick, POLL_MS);
      if (el.error) return giveUp();
      if (el.ended || el.currentTime >= time - 0.05) return resolve();
      if (el.paused) {
        if (waited > NO_VIDEO_MS) return giveUp();
        void el.play().catch(() => {});
      }
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

/** Paces playback events against the attempt videos of one recorded run. */
export interface PlaybackGate {
  /** Video time this event waits for, or null when it plays on the normal clock. */
  at(ev: UiEvent): number | null;
  wait(ev: UiEvent, time: number): Promise<void>;
}

/** Events between an attempt's first video frame and its verdict wait for that attempt's video. */
export function videoGate(runId: string, timings: Map<number, VideoTiming>): PlaybackGate {
  const attemptOf = (ev: UiEvent): number | null =>
    "attempt_no" in ev && typeof ev.attempt_no === "number" ? ev.attempt_no : null;
  return {
    at(ev) {
      if (ev.type === "diagnosis" || ev.type === "attempt_started") return null;
      const n = attemptOf(ev);
      const timing = n === null ? undefined : timings.get(n);
      if (!timing || timing.knots.length === 0) return null;
      const unix = Date.parse(ev.ts) / 1000;
      if (!Number.isFinite(unix) || unix < timing.knots[0][0]) return null;
      return videoTimeAt(timing, unix);
    },
    wait(ev, time) {
      return waitForVideo(videoKey(runId, attemptOf(ev) ?? 0), time);
    },
  };
}
