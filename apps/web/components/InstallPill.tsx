"use client";

import { useState } from "react";

import { PKG } from "@/lib/pkg";

/** `$ npm i askyoda` with a copy button. */
export default function InstallPill({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PKG.install);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure context, permissions): the command is still visible.
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-full border border-moss-800 bg-ink-900 py-1.5 pl-5 pr-1.5 font-mono text-sm ${className}`}
    >
      <span className="text-ink-500" aria-hidden>
        $
      </span>
      <code className="text-ink-50">{PKG.install}</code>
      {!PKG.published && (
        <span className="rounded-full border border-ochre-800 bg-ochre-950 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ochre-200">
          publishing soon
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-200 transition-colors hover:bg-ink-700 hover:text-ink-50"
        aria-label="Copy the install command"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
