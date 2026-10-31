import LadderDiagram from "@/components/diagrams/LadderDiagram";

const RUNGS = [
  {
    n: "01",
    title: "Fetch",
    cost: "free",
    body: "Reads the page text with TinyFish Fetch and extracts the answer. Most simple pages stop here.",
  },
  {
    n: "02",
    title: "Agent",
    cost: "~1 credit / step",
    body: "A live TinyFish browser that clicks, scrolls and waits — every step streamed and traced.",
  },
  {
    n: "03",
    title: "Agent + stealth",
    cost: "only if blocked",
    body: "An anti-bot browser profile behind a proxy, for sites that turn the plain agent away.",
  },
];

const LOOP = [
  {
    title: "Verify",
    body: "Every answer is checked against your rule, the schema and block signals. The agent's own “done” is never trusted.",
  },
  {
    title: "Diagnose",
    body: "A failure gets a class, the step where it broke and quoted evidence — rules first, an LLM when the rules are unsure.",
  },
  {
    title: "Fix or stop",
    body: "The next attempt is patched automatically. Login walls and captchas stop at once, with an honest reason.",
  },
];

export default function HowItWorks() {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">How it works</p>
          <h2 className="mt-2 font-display text-4xl tracking-tight text-ink-50">
            Cheap first. Escalate only when it fails.
          </h2>
        </div>
        <p className="max-w-md text-ink-300">
          A run climbs a three-rung ladder and stops at the first rung whose answer passes
          verification. A hard budget caps attempts and credits.
        </p>
      </div>

      <div data-reveal className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <LadderDiagram />
        <ol className="space-y-5 self-center">
          {RUNGS.map((r) => (
            <li key={r.n} className="grid grid-cols-[2.5rem_1fr] gap-3">
              <span className="font-mono text-sm text-moss-400">{r.n}</span>
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="font-display text-2xl text-ink-50">{r.title}</h3>
                  <span className="kicker">{r.cost}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-300">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div data-reveal className="grid gap-4 md:grid-cols-3">
        {LOOP.map((step, i) => (
          <div key={step.title} className="flex gap-4">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink-600 font-mono text-xs text-ink-300">
              {i + 1}
            </span>
            <div>
              <h3 className="font-medium text-ink-50">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-300">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
