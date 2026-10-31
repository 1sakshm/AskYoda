import DemoRunPicker from "@/components/DemoRunPicker";
import PageHead from "@/components/PageHead";

export const metadata = { title: "Recorded runs · AskYoda" };

export default function RecordingsPage() {
  return (
    <main className="space-y-10">
      <PageHead
        kicker="Free to watch"
        title="Recorded runs"
        body="Real runs, recorded with video of the agent's browser. They play instantly in your browser — no credits, no waiting for a live session."
      />
      <DemoRunPicker />
    </main>
  );
}
