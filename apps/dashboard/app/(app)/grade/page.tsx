import { dashboardData } from "@/lib/data";
import { GradeSheetView } from "@/components/GradeSheetView";

export default async function GradePage() {
  const sheet = await dashboardData.getGradeSheet();
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
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>Grade sheet</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Generated at {sheet.generatedAtMsgId}. Fill-independent: CLV grades every quote
        against the close whether matched or not.
      </p>
      <GradeSheetView sheet={sheet} />
    </div>
  );
}
