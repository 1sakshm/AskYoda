import AloneShortfalls from "@/components/AloneShortfalls";
import LoopDiagram from "@/components/diagrams/LoopDiagram";
import HowItWorks from "@/components/HowItWorks";
import Link from "next/link";

function Hero() {
  return (
    <section className="animate-rise grid gap-10 pb-4 lg:grid-cols-[1.25fr_1fr] lg:items-center">
      <div>
        <p className="kicker">A reliability layer for TinyFish web agents</p>
        <h1 className="mt-5 font-display text-5xl leading-[1.02] tracking-tight text-ink-50 sm:text-7xl">
          Your agent said <em className="text-moss-300">done.</em>
          <br />
          We check.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-300">
          AskYoda runs your goal, verifies the answer itself, names what went wrong and at which
          step, patches the next attempt — and stops honestly when a fix is impossible.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/recordings" className="btn-primary">
            Watch a recorded run
            <span aria-hidden>→</span>
          </Link>
          <Link href="/real" className="btn-ghost">
            Real websites
          </Link>
        </div>
        <dl className="mt-10 grid max-w-xl grid-cols-3 gap-6 border-t border-ink-700/70 pt-6">
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
    <section className="grid gap-px overflow-hidden rounded-2xl border border-ink-700 bg-ink-700 sm:grid-cols-2 xl:grid-cols-4">
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
      <HowItWorks />
    </main>
  );
}
