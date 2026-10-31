"use client";

import { useEffect, useRef, useState } from "react";

import DiagnosisCard from "@/components/DiagnosisCard";
import { KIND_ICON, RUNG_LABEL, relTime } from "@/lib/format";
import type { AttemptView } from "@/lib/runState";
import type { TraceEvent } from "@/lib/types";

interface Props {
  attempts: AttemptView[];
}

const STICK_PX = 80;

export function rowId(attemptNo: number, seq: number): string {
  return `ev-${attemptNo}-${seq}`;
}

/** Chips describing how an attempt was configured (browser, proxy, cache, patches). */
export function attemptChips(a: AttemptView): string[] {
  const chips: string[] = [];
  if (a.rung !== "fetch") chips.push(a.config.browser_profile);
  if (a.config.proxy_enabled) chips.push(`proxy ${a.config.proxy_country ?? ""}`.trim());
  if (a.config.from_fetch_cache) chips.push("cached Fetch · 0 credits");
  return [...chips, ...a.config.patches_applied];
}

function Chip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="max-w-[16rem] truncate rounded-full border border-ink-700 px-2 py-0.5 font-mono text-[11px] text-ink-300"
    >
      {text}
    </span>
  );
}

function TraceRow({ ev, attempt }: { ev: TraceEvent; attempt: AttemptView }) {
  const [open, setOpen] = useState(false);
  const failing = ev.seq === attempt.failingSeq;
  return (
    <li
      id={rowId(attempt.attemptNo, ev.seq)}
      className={`scroll-mt-4 rounded-lg px-3 py-2 ${
        failing
          ? "animate-fail-flash border-l-2 border-ember-400 bg-ember-950"
          : "hover:bg-ink-800/60"
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span className="w-4 shrink-0 text-center text-ink-500" aria-hidden>
          {KIND_ICON[ev.kind]}
        </span>
        <span className="w-[4.25rem] shrink-0 font-mono text-xs text-ink-500">
          {relTime(ev.ts, attempt.startedAt)}
        </span>
        <span className="min-w-0 flex-1 break-words text-sm text-ink-100">
          {ev.step_no ? (
            <span className="mr-2 font-mono text-xs text-ink-400">step {ev.step_no}</span>
          ) : null}
          {ev.label}
        </span>
        {failing && (
          <span className="shrink-0 font-mono text-xs text-ember-300">✕ failed here</span>
        )}
        <button
          type="button"
          className="shrink-0 font-mono text-xs text-ink-500 hover:text-ink-200"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          raw
        </button>
      </div>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-xs text-ink-300">
          {JSON.stringify(ev.raw, null, 2)}
        </pre>
      )}
    </li>
  );
}

function VerifyRow({ attempt }: { attempt: AttemptView }) {
  const [open, setOpen] = useState(false);
  const v = attempt.verify;
  if (!v) return null;
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        v.passed
          ? "border-moss-800 bg-moss-950 text-moss-200"
          : "border-ember-800 bg-ember-950 text-ember-200"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left text-sm font-medium"
      >
        {v.passed ? "✓ " : "✕ "}
        {v.summary}
        <span className="ml-2 font-mono text-xs font-normal opacity-70">
          {open ? "hide" : "details"}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          <ul className="space-y-0.5">
            {v.checks.map((c) => (
              <li key={c.name} className={c.passed ? "text-moss-200" : "text-ember-200"}>
                {c.passed ? "✓" : "✕"} <span className="font-mono">{c.name}</span>: {c.detail}
              </li>
            ))}
          </ul>
          {v.block_signals.length > 0 && (
            <div>
              <div className="kicker">Block signals</div>
              <ul className="space-y-0.5">
                {v.block_signals.map((s, i) => (
                  <li key={i} className="text-ink-200">
                    <span className="font-mono">{s.kind}</span> in {s.where}: “{s.evidence}”
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const STATUS_ICON: Record<AttemptView["status"], string> = {
  running: "…",
  passed: "✓",
  failed: "✕",
};

const STATUS_DOT: Record<AttemptView["status"], string> = {
  running: "bg-moss-950 text-moss-300 ring-1 ring-moss-800",
  passed: "bg-moss-400 text-ink-950",
  failed: "bg-ember-400 text-ink-950",
};

export default function TraceTimeline({ attempts }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pendingJump = useRef<{ attemptNo: number; seq: number } | null>(null);
  const seenFailing = useRef(new Set<string>());
  /** While a failing step is being shown, following the newest event waits (ms timestamp). */
  const holdUntil = useRef(0);
  /** Scroll events before this time come from our own scrolling, not the user. */
  const programmaticUntil = useRef(0);
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  const latest = attempts.length ? attempts[attempts.length - 1].attemptNo : null;
  const isOpen = (n: number) => overrides[n] ?? n === latest;
  const eventCount = attempts.reduce((n, a) => n + a.events.length + (a.verify ? 1 : 0), 0);
  const failingRows = attempts
    .filter((a) => a.failingSeq !== null && isOpen(a.attemptNo))
    .map((a) => rowId(a.attemptNo, a.failingSeq as number))
    .join("|");

  // Follow the newest event unless the user scrolled up; wait while a failing step is shown.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    const toBottom = () => {
      programmaticUntil.current = performance.now() + 300;
      el.scrollTop = el.scrollHeight;
    };
    const wait = holdUntil.current - performance.now();
    if (wait <= 0) {
      toBottom();
      return;
    }
    const timer = window.setTimeout(() => {
      if (stick.current) toBottom();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [eventCount]);

  // When a diagnosis arrives, bring its (red, flashing) failing step into view once.
  useEffect(() => {
    for (const id of failingRows ? failingRows.split("|") : []) {
      if (seenFailing.current.has(id)) continue;
      seenFailing.current.add(id);
      holdUntil.current = performance.now() + 2500;
      programmaticUntil.current = performance.now() + 1000;
      document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [failingRows]);

  // Runs after every render: performs a requested jump once its group is expanded.
  useEffect(() => {
    const jump = pendingJump.current;
    if (!jump) return;
    pendingJump.current = null;
    document
      .getElementById(rowId(jump.attemptNo, jump.seq))
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  function jumpTo(attemptNo: number, seq: number) {
    stick.current = false;
    pendingJump.current = { attemptNo, seq };
    setOverrides((o) => ({ ...o, [attemptNo]: true }));
  }

  return (
    <div
      ref={scroller}
      className="max-h-[78vh] space-y-4 overflow-y-auto pr-1"
      onScroll={(e) => {
        if (performance.now() < programmaticUntil.current) return;
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      }}
    >
      {attempts.length === 0 && (
        <p className="panel px-5 py-8 text-center text-ink-400">Waiting for the first event…</p>
      )}
      {attempts.map((attempt) => {
        const open = isOpen(attempt.attemptNo);
        const failing = attempt.events.find((e) => e.seq === attempt.failingSeq);
        return (
          <section key={attempt.attemptNo} className="panel p-3">
            <button
              type="button"
              onClick={() => setOverrides((o) => ({ ...o, [attempt.attemptNo]: !open }))}
              aria-expanded={open}
              className="mb-2 flex w-full flex-wrap items-center gap-2 px-1 py-1 text-left"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs ${STATUS_DOT[attempt.status]}`}
                aria-hidden
              >
                {STATUS_ICON[attempt.status]}
              </span>
              <span className="text-sm font-medium text-ink-50">
                Attempt {attempt.attemptNo}
                <span className="ml-2 font-normal text-ink-400">{RUNG_LABEL[attempt.rung]}</span>
              </span>
              {attemptChips(attempt).map((chip) => (
                <Chip key={chip} text={chip} />
              ))}
              <span className="ml-auto font-mono text-xs text-ink-500">{open ? "−" : "+"}</span>
            </button>
            <ol className="space-y-0.5">
              {open &&
                attempt.events
                  .filter((ev) => ev.kind !== "heartbeat")
                  .map((ev) => <TraceRow key={ev.seq} ev={ev} attempt={attempt} />)}
              <VerifyRow attempt={attempt} />
            </ol>
            {/* The diagnosis stays visible when the attempt collapses: it is the story. */}
            {attempt.diagnosis && (
              <div className="mt-3">
                <DiagnosisCard
                  diagnosis={attempt.diagnosis}
                  failingStepNo={failing?.step_no ?? null}
                  onJumpToStep={(seq) => jumpTo(attempt.attemptNo, seq)}
                  rung={attempt.rung}
                  nextConfig={
                    attempts.find((a) => a.attemptNo === attempt.attemptNo + 1)?.config ?? null
                  }
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
