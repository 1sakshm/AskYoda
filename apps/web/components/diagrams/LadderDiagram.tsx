"use client";

import { useEffect, useRef, useState } from "react";

import { useInView, usePageVisible, useReducedMotion } from "@/components/motion/hooks";

type Spot = "start" | "fetch" | "agent" | "stealth" | "human";
type Mark = "try" | "fail" | "pass" | "skip" | "stop";

interface Frame {
  at: Spot;
  mark: Mark;
}

interface Story {
  name: string;
  caption: string;
  frames: Frame[];
}

const STORIES: Story[] = [
  {
    name: "Simple page",
    caption: "Fetch reads the text and the answer passes the check — verified for 0 credits.",
    frames: [
      { at: "fetch", mark: "try" },
      { at: "fetch", mark: "pass" },
    ],
  },
  {
    name: "Needs a click",
    caption: "The data appears only after a click, so Fetch fails and the agent opens the tab.",
    frames: [
      { at: "fetch", mark: "try" },
      { at: "fetch", mark: "fail" },
      { at: "agent", mark: "try" },
      { at: "agent", mark: "pass" },
    ],
  },
  {
    name: "Bot wall",
    caption: "Fetch hits a bot wall, so the plain agent is skipped for stealth + proxy.",
    frames: [
      { at: "fetch", mark: "try" },
      { at: "fetch", mark: "fail" },
      { at: "agent", mark: "skip" },
      { at: "stealth", mark: "try" },
      { at: "stealth", mark: "pass" },
    ],
  },
  {
    name: "Login wall",
    caption: "A login wall can't be fixed by retrying: the run stops and asks for a human.",
    frames: [
      { at: "fetch", mark: "try" },
      { at: "fetch", mark: "fail" },
      { at: "human", mark: "stop" },
    ],
  },
];

const FRAME_MS = 1050;
const HOLD_MS = 2600;

const RUNGS: { spot: Exclude<Spot, "start" | "human">; title: string; cost: string }[] = [
  { spot: "fetch", title: "Fetch", cost: "free" },
  { spot: "agent", title: "Agent", cost: "1 cr / step" },
  { spot: "stealth", title: "Stealth + proxy", cost: "if blocked" },
];

// Where each rung's platform sits, as % of the stage (left edge, bottom edge).
const PLATFORM: Record<"fetch" | "agent" | "stealth", { left: number; bottom: number }> = {
  fetch: { left: 4, bottom: 8 },
  agent: { left: 35, bottom: 34 },
  stealth: { left: 66, bottom: 60 },
};
const PLATFORM_WIDTH = 30;

function tokenPos(at: Spot): { left: string; bottom: string } {
  if (at === "human") return { left: "81%", bottom: "16%" };
  if (at === "start") return { left: "1%", bottom: "1%" };
  const p = PLATFORM[at];
  return { left: `${p.left + PLATFORM_WIDTH / 2}%`, bottom: `calc(${p.bottom}% + 3.6rem)` };
}

function rungMark(story: Story, frameIdx: number, spot: Spot): Mark | null {
  let mark: Mark | null = null;
  story.frames.slice(0, frameIdx + 1).forEach((f) => {
    if (f.at === spot) mark = f.mark;
  });
  return mark;
}

const RUNG_STYLE: Record<Mark | "idle", string> = {
  idle: "border-ink-700 bg-ink-900/80 text-ink-300",
  try: "border-ochre-400/70 bg-ochre-950 text-ink-50",
  fail: "border-ember-500/70 bg-ember-950 text-ink-100",
  pass: "border-moss-400 bg-moss-900/80 text-ink-50",
  skip: "border-dashed border-ink-600 bg-transparent text-ink-500",
  stop: "border-ember-500/70 bg-ember-950 text-ink-100",
};

const MARK_WORD: Partial<Record<Mark, string>> = {
  try: "trying…",
  fail: "✕ rejected",
  pass: "✓ verified",
  skip: "skipped",
};

/**
 * The escalation ladder, animated: a run climbs Fetch → Agent → Stealth + proxy and stops at the
 * first rung whose answer passes, or leaves the ladder when only a human can help. Cycles through
 * four stories; the visitor can pick one. Reduced motion shows each story's end state.
 */
export default function LadderDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const [storyIdx, setStoryIdx] = useState(1);
  const [frameIdx, setFrameIdx] = useState(0);

  const story = STORIES[storyIdx];
  const last = story.frames.length - 1;
  const frame = reduced ? story.frames[last] : story.frames[frameIdx];
  const shownIdx = reduced ? last : frameIdx;
  const running = inView && visible && !reduced;

  useEffect(() => {
    if (!running) return;
    const atEnd = frameIdx >= last;
    const timer = window.setTimeout(
      () => {
        if (atEnd) {
          setStoryIdx((s) => (s + 1) % STORIES.length);
          setFrameIdx(0);
        } else {
          setFrameIdx((f) => f + 1);
        }
      },
      atEnd ? HOLD_MS : FRAME_MS,
    );
    return () => window.clearTimeout(timer);
  }, [running, frameIdx, last]);

  const pick = (i: number) => {
    setStoryIdx(i);
    setFrameIdx(0);
  };

  const humanOn = frame.at === "human";
  const finalMark = story.frames[last].mark;
  const finished = shownIdx === last;

  return (
    <div ref={ref} className="panel overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Example runs">
          {STORIES.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === storyIdx}
              onClick={() => pick(i)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                i === storyIdx
                  ? "bg-ink-100 text-ink-950"
                  : "border border-ink-700 text-ink-300 hover:border-ink-500 hover:text-ink-50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <span className="kicker">escalation ladder</span>
      </div>

      {/* The stage: three platforms climbing left to right, plus the human exit. */}
      <div className="relative mt-6 aspect-[4/3] w-full sm:aspect-[16/7]" aria-hidden>
        <svg
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <path
            d="M19 86 L50 60 L81 34"
            className="stroke-ink-600"
            strokeWidth="1"
            strokeDasharray="4 5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M19 86 L81 78"
            className={humanOn ? "stroke-ember-500/70" : "stroke-ink-700"}
            strokeWidth="1"
            strokeDasharray="4 5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {RUNGS.map((r) => {
          const mark = rungMark(story, shownIdx, r.spot);
          const p = PLATFORM[r.spot];
          return (
            <div
              key={r.spot}
              className={`absolute rounded-xl border px-3 py-2 transition-colors duration-500 sm:px-4 sm:py-3 ${
                RUNG_STYLE[mark ?? "idle"]
              }`}
              style={{ left: `${p.left}%`, bottom: `${p.bottom}%`, width: `${PLATFORM_WIDTH}%` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium sm:text-sm">{r.title}</span>
                <span className="hidden font-mono text-[10px] text-ink-400 sm:inline">
                  {r.cost}
                </span>
              </div>
              <div className="mt-0.5 h-4 font-mono text-[10px] sm:text-[11px]">
                {mark ? MARK_WORD[mark] : ""}
              </div>
            </div>
          );
        })}

        <div
          className={`absolute right-0 bottom-[4%] w-[34%] rounded-xl border px-3 py-2 transition-colors duration-500 sm:px-4 sm:py-3 ${
            humanOn ? RUNG_STYLE.stop : "border-dashed border-ink-700 text-ink-500"
          }`}
        >
          <div className="truncate text-xs font-medium sm:text-sm">
            <span className="sm:hidden">Needs a human</span>
            <span className="hidden sm:inline">Needs human escalation</span>
          </div>
          <div className="mt-0.5 h-4 font-mono text-[10px] sm:text-[11px]">
            {humanOn ? "login · captcha · blocked" : ""}
          </div>
        </div>

        {/* The run itself. */}
        <span
          className={`absolute z-10 -ml-2.5 h-5 w-5 rounded-full border-2 border-ink-950 transition-all duration-700 ease-[cubic-bezier(0.5,0,0.2,1)] ${
            humanOn
              ? "bg-ember-400"
              : finished && finalMark === "pass"
                ? "bg-moss-300"
                : "bg-ochre-300"
          } ${frame.mark === "try" ? "ay-pulse" : ""}`}
          style={tokenPos(frame.at === "agent" && frame.mark === "skip" ? "fetch" : frame.at)}
        />
      </div>

      <p className="mt-5 min-h-[3rem] text-sm leading-relaxed text-ink-300" aria-live="polite">
        <span className="font-medium text-ink-50">{story.name}.</span> {story.caption}
      </p>
    </div>
  );
}
