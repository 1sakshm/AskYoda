"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="animate-rise mx-auto max-w-2xl space-y-6 rounded-2xl border border-ember-500/40 bg-ember-950 p-8">
      <p className="kicker">Error</p>
      <h1 className="font-display text-4xl tracking-tight text-ink-50">
        Something went wrong on this page
      </h1>
      <p className="break-words font-mono text-sm text-ember-200">{message}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn-primary">
          Try again
        </button>
        <Link href="/dev" className="btn-ghost">
          Open the sample run
        </Link>
      </div>
    </main>
  );
}
