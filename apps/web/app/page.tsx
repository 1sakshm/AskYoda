import AloneShortfalls from "@/components/AloneShortfalls";
import DemoRunPicker from "@/components/DemoRunPicker";
import LoopDiagram from "@/components/diagrams/LoopDiagram";
import HowItWorks from "@/components/HowItWorks";
import LiveBudget from "@/components/LiveBudget";
import RunForm from "@/components/RunForm";
import ScenarioCards from "@/components/ScenarioCards";
import { DEMO_MODE } from "@/lib/api";

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
          <a href="#scenarios" className="btn-primary">
            Run a prepared case
            <span aria-hidden>→</span>
          </a>
          <a href="#custom" className="btn-ghost">
            Bring your own URL
          </a>
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

const TIPS = [
  ["Be specific", "“List the first 3 products with name and price” beats “get the products”."],
  [
    "Add a check",
    "A text the answer must contain lets the verifier catch a wrong — not just an empty — answer.",
  ],
  ["Start cheap", "Leave the start rung on Fetch: it costs nothing and escalates on its own."],
  ["Expect honesty", "Login walls and captchas stop at once instead of burning credits."],
];

function FormTips() {
  return (
    <aside className="space-y-5 lg:pt-2">
      <p className="kicker">Getting a good run</p>
      <ul className="space-y-5">
        {TIPS.map(([title, body]) => (
          <li key={title} className="border-l border-ink-700 pl-4">
            <p className="font-medium text-ink-50">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-400">{body}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="kicker">{kicker}</p>
        <h2 className="mt-2 font-display text-4xl tracking-tight text-ink-50">{title}</h2>
      </div>
      {body && <p className="max-w-md text-ink-300">{body}</p>}
    </div>
  );
}

export default function Home() {
  if (DEMO_MODE) {
    return (
      <main className="space-y-20">
        <Hero />
        <AloneShortfalls />
        <HowItWorks />
        <section className="space-y-6">
          <SectionHead
            kicker="Recorded"
            title="Bundled runs"
            body="Each one replays a full run in your browser: the ladder, every step, the verifier, the diagnosis and the verdict."
          />
          <DemoRunPicker />
        </section>
        <section id="custom" className="scroll-mt-24 space-y-6">
          <SectionHead kicker="Custom" title="Run your own" />
          <RunForm disabledNote="Live runs need the API, which isn't part of this demo deployment." />
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-20">
      <Hero />
      <AloneShortfalls />
      <LiveBudget />
      <ScenarioCards />
      <section id="custom" className="scroll-mt-24 space-y-6">
        <SectionHead
          kicker="Custom"
          title="Bring your own URL"
          body="Any public page and a plain-English goal. Add a check so the verifier knows what a right answer looks like."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <RunForm />
          <FormTips />
        </div>
      </section>
      <HowItWorks />
      <section className="space-y-6">
        <SectionHead
          kicker="Free to watch"
          title="Recorded runs"
          body="Played in your browser from files bundled with the site — no credits, no API calls."
        />
        <DemoRunPicker />
      </section>
    </main>
  );
}
