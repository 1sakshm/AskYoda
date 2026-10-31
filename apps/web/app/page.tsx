import Link from "next/link";

import AloneShortfalls from "@/components/AloneShortfalls";
import CodeShowcase from "@/components/CodeShowcase";
import LoopDiagram from "@/components/diagrams/LoopDiagram";
import HowItWorks from "@/components/HowItWorks";
import InstallPill from "@/components/InstallPill";
import { PKG, PKG_BADGES } from "@/lib/pkg";

function Hero() {
  return (
    <section className="animate-rise grid gap-12 pb-4 lg:grid-cols-[1.1fr_1fr] lg:items-center">
      <div>
        <p className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-moss-800 bg-moss-950 px-3 py-1 font-mono text-xs text-moss-300">
            npm package · v{PKG.version}
          </span>
          <span className="kicker">for TinyFish web agents</span>
        </p>
        <h1 className="mt-6 font-display text-5xl leading-[1.02] tracking-tight text-ink-50 sm:text-7xl">
          Your agent said <em className="text-moss-300">done.</em>
          <br />
          We check.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-300">
          One install wraps every TinyFish run: AskYoda verifies the answer itself, names what went
          wrong and at which step, patches the next attempt — and hands it to a human when no retry
          can help.
        </p>
        <InstallPill className="mt-8" />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/package" className="btn-primary">
            Get the package
            <span aria-hidden>→</span>
          </Link>
          <Link href="/recordings" className="btn-ghost">
            Watch it work
          </Link>
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-ink-400">
          {PKG_BADGES.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-moss-400" aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <CodeShowcase />
    </section>
  );
}

function Inside() {
  return (
    <section data-reveal className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div>
        <p className="kicker">Inside one run</p>
        <h2 className="mt-2 font-display text-4xl tracking-tight text-ink-50">
          Checked, not trusted.
        </h2>
        <p className="mt-4 max-w-md text-ink-300">
          The first agent run said COMPLETED with 8 of 24 jobs. AskYoda rejected it, named the
          failure, patched the goal and verified all 24 on the retry.
        </p>
        <dl className="mt-8 grid max-w-md grid-cols-3 gap-6 border-t border-ink-700/70 pt-6">
          {[
            ["6", "failure classes diagnosed"],
            ["3", "rungs, cheapest first"],
            ["0", "credits when Fetch is enough"],
          ].map(([n, label]) => (
            <div key={label}>
              <dt className="font-display text-4xl text-ink-50">{n}</dt>
              <dd className="mt-1 text-sm leading-snug text-ink-400">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
      <LoopDiagram />
    </section>
  );
}

const PAGES = [
  {
    href: "/package",
    kicker: "npm i askyoda",
    title: "The package",
    body: "One call: verify, diagnose, fix, escalate.",
  },
  {
    href: "/cases",
    kicker: "Built to fail",
    title: "Prepared cases",
    body: "Test pages that each trip one failure on purpose.",
  },
  {
    href: "/real",
    kicker: "In the wild",
    title: "Real websites",
    body: "Public sites where a plain run falls short.",
  },
  {
    href: "/recordings",
    kicker: "Free to watch",
    title: "Recorded runs",
    body: "Real runs with video of the agent's browser.",
  },
  {
    href: "/results",
    kicker: "Scoreboard",
    title: "Results",
    body: "What was fixed, escalated and saved.",
  },
];

function Explore() {
  return (
    <section className="grid gap-px overflow-hidden rounded-2xl border border-ink-700 bg-ink-700 sm:grid-cols-2 xl:grid-cols-5">
      {PAGES.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          className="group flex flex-col gap-2 bg-ink-900 p-6 transition-colors hover:bg-ink-850"
        >
          <span className="kicker">{p.kicker}</span>
          <span className="flex items-center justify-between font-display text-3xl text-ink-50">
            {p.title}
            <span className="text-xl text-ink-500 transition-transform group-hover:translate-x-1 group-hover:text-moss-300">
              →
            </span>
          </span>
          <span className="text-sm text-ink-400">{p.body}</span>
        </Link>
      ))}
    </section>
  );
}

export default function Home() {
  return (
    <main className="space-y-20">
      <Hero />
      <Explore />
      <AloneShortfalls />
      <Inside />
      <HowItWorks />
    </main>
  );
}
