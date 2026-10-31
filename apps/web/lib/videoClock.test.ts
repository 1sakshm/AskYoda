import { describe, expect, it } from "vitest";

import { playEvents } from "./demoSource";
import type { UiEvent } from "./types";
import { videoGate, videoTimeAt, type PlaybackGate, type VideoTiming } from "./videoClock";

const T0 = Date.parse("2026-11-01T11:00:00Z") / 1000;
const timing: VideoTiming = {
  // A 20 s still stretch (T0+2 -> T0+22) is cut to 2 s of video.
  knots: [
    [T0, 0],
    [T0 + 2, 2],
    [T0 + 22, 4],
    [T0 + 24, 6],
  ],
  duration: 7.5,
};

const at = (seconds: number) => new Date((T0 + seconds) * 1000).toISOString();
const ev = (seq: number, type: string, seconds: number, attempt_no = 2) =>
  ({ type, seq, run_id: "r", ts: at(seconds), attempt_no }) as unknown as UiEvent;

describe("videoTimeAt", () => {
  it("maps wall-clock time onto the video, cutting still stretches", () => {
    expect(videoTimeAt(timing, T0 - 5)).toBe(0);
    expect(videoTimeAt(timing, T0 + 1)).toBeCloseTo(1);
    expect(videoTimeAt(timing, T0 + 12)).toBeCloseTo(3);
    expect(videoTimeAt(timing, T0 + 99)).toBe(6);
  });
});

describe("videoGate", () => {
  const gate = videoGate("demo-x", new Map([[2, timing]]));

  it("paces only the attempt's events after its first frame", () => {
    expect(gate.at(ev(1, "trace_event", 12))).toBeCloseTo(3);
    expect(gate.at(ev(2, "trace_event", -3))).toBeNull(); // before the video starts
    expect(gate.at(ev(3, "trace_event", 12, 1))).toBeNull(); // another attempt
    expect(gate.at(ev(4, "diagnosis", 30))).toBeNull(); // shown on the normal clock
  });
});

describe("playEvents with a gate", () => {
  it("waits for the gate instead of the clock", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate: PlaybackGate = {
      at: (e) => (e.seq === 2 ? 1 : null),
      wait: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const events = [ev(1, "budget", 0), ev(2, "trace_event", 60), ev(3, "verdict", 61)];
    const done = new Promise<void>((resolve) => {
      playEvents(events, (e) => order.push(String(e.seq)), { gate, onDone: resolve });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["1"]); // held by the gate, not a 60 s gap
    release();
    await done;
    expect(order).toEqual(["1", "2", "3"]);
  });
});
