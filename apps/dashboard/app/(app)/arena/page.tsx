import { dashboardData } from "@/lib/data";
import { ArenaView } from "@/components/ArenaView";
import { AblationMatrixView } from "@/components/AblationMatrixView";

export default async function ArenaPage() {
  const [summary, ablation] = await Promise.all([
    dashboardData.getArenaSummary(),
    dashboardData.getAblationMatrix(),
  ]);
  return (
    <div>
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>Strategy arena</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Agent vs agent, on the real feed. Computed on demand from the fixture&apos;s
        authoritative corpus — not a second continuously running live session.
      </p>
      <ArenaView summary={summary} />
      <div style={{ marginTop: 20 }}>
        <AblationMatrixView summary={ablation} />
      </div>
    </div>
  );
}
