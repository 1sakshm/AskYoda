import Link from "next/link";

export default function NotFound() {
  return (
    <main className="animate-rise mx-auto max-w-2xl space-y-6 py-16 text-center">
      <p className="kicker">404</p>
      <h1 className="font-display text-6xl tracking-tight text-ink-50">Nothing here.</h1>
      <p className="text-lg text-ink-300">
        This page doesn&apos;t exist. Try one of these instead.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">
          Start a run
        </Link>
        <Link href="/results" className="btn-ghost">
          See results
        </Link>
        <Link href="/dev" className="btn-ghost">
          Sample run
        </Link>
      </div>
    </main>
  );
}
