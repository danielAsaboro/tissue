import { dashboardData } from "@/lib/data";
import { ScoreboardView } from "@/components/ScoreboardView";

export default async function ScoreboardPage() {
  const summary = await dashboardData.getBacktestTimeline();
  return (
    <div>
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>Scoreboard</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Strike rate, streaks, and the full decision-by-decision record — computed on demand
        from the fixture&apos;s authoritative corpus. Updates live as the desk posts new decisions.
      </p>
      <ScoreboardView summary={summary} />
    </div>
  );
}
