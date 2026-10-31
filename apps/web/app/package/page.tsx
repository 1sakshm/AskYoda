import CodeShowcase from "@/components/CodeShowcase";
import InstallPill from "@/components/InstallPill";
import PageHead from "@/components/PageHead";
import { PKG, PKG_BADGES } from "@/lib/pkg";

export const metadata = { title: "npm package · AskYoda" };

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-950 p-5 font-mono text-[13px] leading-6 text-ink-100">
      {children}
    </pre>
  );
}

function Section({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section data-reveal className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <p className="kicker">{kicker}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight text-ink-50">{title}</h2>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

const FLAGS: [string, string][] = [
  [
    "--min-items path:N · --contains TEXT · --regex P · --fields a,b",
    "the check the answer must pass",
  ],
  ["--schema file.json", "TinyFish output schema"],
  ["--start fetch|agent|agent_stealth", "starting rung (default fetch)"],
  ["--max-credits N · --max-attempts N", "hard budget (defaults 40 / 4)"],
  ["--proxy CC", "proxy country for the stealth rung"],
  ["--llm gemini|anthropic|none", "optional LLM (default: whichever key is set)"],
  ["--json · --quiet", "machine-readable output · verdict only"],
];

const CLASSES: [string, string][] = [
  [
    "needs_interaction",
    "Escalate from Fetch, or tell the agent to click, search, “Load more” or “Next”.",
  ],
  ["popup_overlay", "Prefix the goal with “close cookie and consent dialogs first”."],
  [
    "misread_page",
    "Free re-extraction from the cached page, or a tighter schema plus “return at least N items”.",
  ],
  ["bot_block", "Jump to the stealth browser behind a proxy."],
  ["auth_wall", "Stop — needs human escalation, with 0 wasted credits."],
  ["captcha", "Stop — needs human escalation."],
];

export default function PackagePage() {
  return (
    <main className="space-y-16">
      <PageHead
        kicker={`npm package · v${PKG.version}`}
        title="askyoda"
        body="The whole AskYoda ladder in one function call: run a goal on TinyFish, verify the answer, diagnose and patch failures, and escalate to a human when no retry can help — inside a hard credit budget."
      />
      <div className="flex flex-wrap items-center gap-3">
        <InstallPill />
        <a
          href={PKG.published ? PKG.npmUrl : PKG.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          {PKG.published ? "View on npm ↗" : "View the source ↗"}
        </a>
      </div>
      <ul className="flex flex-wrap gap-2">
        {PKG_BADGES.map((b) => (
          <li
            key={b}
            className="rounded-full border border-ink-700 px-3 py-1 font-mono text-xs text-ink-300"
          >
            {b}
          </li>
        ))}
      </ul>

      <CodeShowcase />

      <Section kicker="01" title="Quickstart">
        <Code>{`import { AskYoda } from "askyoda";

const yoda = new AskYoda({
  tinyfishKey: process.env.TINYFISH_API_KEY!,
  llm: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY! }, // optional
});

const run = await yoda.run({
  url: "https://example.com/careers",
  goal: "List the open positions with their title and team.",
  expect: { minItems: { path: "positions", min: 20 } },
  maxCredits: 25,
});

run.status;      // "verified" | "needs_human" | "budget_exhausted" | "error" | "cancelled"
run.result;      // the verified answer
run.creditsUsed; // estimated TinyFish credits (1 per agent step)
run.diagnoses;   // what failed, where, with quoted evidence, and the patch applied`}</Code>
        <p className="text-sm text-ink-400">
          Runs bill to your own TinyFish account. The LLM is optional: without one, AskYoda skips
          the free Fetch extraction and diagnoses with its built-in rules.
        </p>
      </Section>

      <Section kicker="02" title="From the terminal">
        <Code>{`export TINYFISH_API_KEY=...

npx askyoda run https://example.com/careers \\
  "List the open positions with their title and team." \\
  --min-items positions:20 --max-credits 25`}</Code>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-ink-800">
              {FLAGS.map(([flag, what]) => (
                <tr key={flag}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-100">{flag}</td>
                  <td className="px-4 py-2.5 text-ink-400">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-ink-400">
          Exit codes: 0 verified · 2 needs human escalation · 3 budget spent · 1 error.
        </p>
      </Section>

      <Section kicker="03" title="Live events">
        <Code>{`await yoda.run({
  url, goal, expect,
  onEvent: (e) => {
    if (e.type === "live_view") console.log("watch:", e.streaming_url);
    if (e.type === "diagnosis") console.log(e.diagnosis.failure_class);
  },
});

for await (const e of yoda.stream({ url, goal, expect })) console.log(e.type);`}</Code>
      </Section>

      <Section kicker="04" title="What it fixes">
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-ink-800">
              {CLASSES.map(([cls, move]) => (
                <tr key={cls}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-100">
                    {cls}
                  </td>
                  <td className="px-4 py-2.5 text-ink-300">{move}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}
