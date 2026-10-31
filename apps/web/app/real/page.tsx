import LiveBudget from "@/components/LiveBudget";
import PageHead from "@/components/PageHead";
import ScenarioCards from "@/components/ScenarioCards";

export const metadata = { title: "Real websites · AskYoda" };

export default function RealSitesPage() {
  return (
    <main className="space-y-10">
      <PageHead
        kicker="In the wild"
        title="Real websites"
        body="Public sites with the same problems: infinite scroll, pagination, load-more buttons and content behind clicks. Where a plain TinyFish run fell short, the card shows it side by side with AskYoda."
      />
      <LiveBudget />
      <ScenarioCards kind="real" />
    </main>
  );
}
