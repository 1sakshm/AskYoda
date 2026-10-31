import LiveBudget from "@/components/LiveBudget";
import PageHead from "@/components/PageHead";
import ScenarioCards from "@/components/ScenarioCards";

export const metadata = { title: "Prepared cases · AskYoda" };

export default function CasesPage() {
  return (
    <main className="space-y-10">
      <PageHead
        kicker="Test pages built to fail"
        title="Prepared cases"
        body="Our own pages, each built to trip one failure on purpose: content behind a click, a cookie wall, pagination, lazy loading, a login wall, a CAPTCHA, a site that blocks everyone. Watch the recording for free, or run it live."
      />
      <LiveBudget />
      <ScenarioCards kind="lab" />
    </main>
  );
}
