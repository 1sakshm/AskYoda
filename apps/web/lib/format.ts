import type { FailureClass, Rung, RunStatus, TraceKind } from "./types";

export const KIND_ICON: Record<TraceKind, string> = {
  started: "▶",
  live_view: "◉",
  progress: "→",
  heartbeat: "♥",
  complete: "■",
  tf_api_result: "⇄",
  fetch_result: "⇣",
  fetch_error: "⚠",
  extraction: "✦",
  run_snapshot: "≡",
  stream_error: "⚠",
  system: "•",
  unknown: "?",
};

export const RUNG_ORDER: Rung[] = ["fetch", "agent", "agent_stealth"];

export const RUNG_LABEL: Record<Rung, string> = {
  fetch: "Rung 1 · Fetch",
  agent: "Rung 2 · Agent",
  agent_stealth: "Rung 3 · Agent + stealth + proxy",
};

export const RUNG_SHORT: Record<Rung, string> = {
  fetch: "Fetch — free",
  agent: "Agent",
  agent_stealth: "Agent + stealth + proxy",
};

export const CLASS_LABEL: Record<FailureClass, string> = {
  needs_interaction: "Needs interaction",
  popup_overlay: "Popup overlay",
  bot_block: "Bot block",
  misread_page: "Misread page",
  auth_wall: "Auth wall",
  captcha: "Captcha",
};

// Full class strings (not built from parts) so Tailwind can see them. All warm hues: no blue/purple.
export const CLASS_COLOR: Record<FailureClass, string> = {
  needs_interaction: "bg-ochre-400/10 text-ochre-300 ring-1 ring-ochre-400/35",
  popup_overlay: "bg-tangerine-300/10 text-tangerine-300 ring-1 ring-tangerine-300/35",
  bot_block: "bg-ember-400/10 text-ember-300 ring-1 ring-ember-400/40",
  misread_page: "bg-khaki-300/10 text-khaki-300 ring-1 ring-khaki-300/35",
  auth_wall: "bg-ink-300/10 text-ink-200 ring-1 ring-ink-400/40",
  captcha: "bg-clay-300/10 text-clay-300 ring-1 ring-clay-300/35",
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "QUEUED",
  running: "RUNNING",
  verified: "VERIFIED",
  unrecoverable: "UNRECOVERABLE",
  budget_exhausted: "BUDGET SPENT",
  error: "ERROR",
  cancelled: "CANCELLED",
};

export const STATUS_STYLE: Record<RunStatus, string> = {
  queued: "text-ink-300",
  running: "text-moss-300",
  verified: "text-moss-300",
  unrecoverable: "text-ember-300",
  budget_exhausted: "text-ochre-300",
  error: "text-ember-300 underline decoration-ember-500/60",
  cancelled: "text-ink-400",
};

export function fmtCredits(n: number): string {
  return `${n} cr (est.)`;
}

/** Seconds from `t0` to `ts`, e.g. "+12.4s". */
export function relTime(ts: string, t0: string): string {
  const seconds = (Date.parse(ts) - Date.parse(t0)) / 1000;
  if (!Number.isFinite(seconds)) return "";
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}
