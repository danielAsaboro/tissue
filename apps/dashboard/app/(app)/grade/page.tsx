import { dashboardData } from "@/lib/data";
import { GradeSheetView } from "@/components/GradeSheetView";
import { EquityCurve } from "@/components/EquityCurve";
import { MatchHeader } from "@/components/MatchHeader";

export default async function GradePage() {
  const [sheet, equityCurve, meta] = await Promise.all([
    dashboardData.getGradeSheet(),
    dashboardData.getEquityCurve(),
    dashboardData.getActiveFixtureMeta(),
  ]);
  if (!sheet) {
    return (
      <section className="panel">
        <h2>Grade sheet</h2>
        <p className="empty">Waiting for a real TxLINE fixture. No synthetic grade is shown.</p>
      </section>
    );
  }
  return (
    <div>
      <MatchHeader meta={meta} />
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>Grade sheet</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Generated at {sheet.generatedAtMsgId}. Fill-independent: CLV grades every quote
        against the close whether matched or not.
      </p>
      <section className="panel">
        <h2>Public grade card</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          A shareable summary of the numbers above — real CLV, Brier, halt count, and
          per-signal-class hit rate, generated on demand. No fabricated numbers, no
          cherry-picking: the same grader that produced the sheet above.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- daemon-rendered SVG, not a Next asset */}
        <img
          src="/api/desk/grade-card"
          alt="Tissue desk grade card"
          style={{ maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 8, marginTop: 8 }}
        />
        <p style={{ marginTop: 8 }}>
          <a href="/api/desk/grade-card" target="_blank" rel="noreferrer">
            Open full-size / download
          </a>
        </p>
      </section>
      <GradeSheetView sheet={sheet} />
      <div style={{ marginTop: 20 }}>
        <EquityCurve points={equityCurve} />
      </div>
    </div>
  );
}
