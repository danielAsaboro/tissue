import { dashboardData } from "@/lib/data";
import { MatchHistoryTable } from "@/components/MatchHistoryTable";

export default async function MatchesPage() {
  const matches = await dashboardData.getMatchHistory();
  const withResult = matches.filter((m) => m.clvN > 0);
  const wins = withResult.filter((m) => m.pctPositive >= 0.5).length;

  return (
    <div>
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>Matches</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Every fixture this desk has ever priced — live captures and the World Cup 2026 backtest
        archive alike, computed on demand from each fixture&apos;s authoritative corpus. Click a
        match to see its full decision-by-decision record and reasoning.
      </p>
      <section className="panel">
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="metric">
            <span className="label">Matches</span>
            <span className="value">{matches.length}</span>
          </div>
          <div className="metric">
            <span className="label">With a graded result</span>
            <span className="value">{withResult.length}</span>
          </div>
          <div className="metric">
            <span className="label">Wins</span>
            <span className="value">{wins} / {withResult.length}</span>
          </div>
          <div className="metric">
            <span className="label">Hash chain</span>
            <span className="value">{matches.every((m) => m.hashChainOk) ? "All verify" : "Broken chain present"}</span>
          </div>
        </div>
        <MatchHistoryTable matches={matches} />
      </section>
    </div>
  );
}
