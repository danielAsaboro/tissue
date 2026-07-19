import { Fragment } from "react";
import type { DecisionRecord } from "@tissue/shared";
import { formatBpsSigned, formatClock } from "@/lib/format";
import { explainDecision } from "@/lib/decisionNarrative";
import { ClassBadge } from "./ClassBadge";
import { SimBadge } from "./SimBadge";

/**
 * The four regime overlays (mutual-danger, stoppage-time, narrative regime, match phase)
 * run on every decision and shift real spread/size — but until now were only visible by
 * inspecting raw decision JSON. This renders them compactly, only when non-default, so the
 * feed stays scannable but nothing real stays invisible.
 */
function RegimeBadges({ state }: { state: DecisionRecord["state"] }) {
  const badges: { readonly label: string; readonly title: string; readonly tone: string }[] = [];
  if (state.matchPhase !== "regulation") {
    badges.push({
      label: state.matchPhase === "extraTime" ? "ET" : "PEN",
      title: `Match phase: ${state.matchPhase}`,
      tone: "",
    });
  }
  if (state.stoppageActive) {
    badges.push({ label: "STOPPAGE", title: "Discretionary added time — spread widened, lambda floor applied", tone: "badge-sim" });
  }
  if (state.mutualDangerActive) {
    badges.push({ label: "MUTUAL DANGER", title: "Sustained high pressure both sides — spread widened, size cut", tone: "badge-danger" });
  }
  if (state.narrativeRegime && state.narrativeRegime !== "neutral") {
    badges.push({
      label: state.narrativeRegime.toUpperCase(),
      title: `Rolling market regime: ${state.narrativeRegime}`,
      tone: state.narrativeRegime === "cautious" ? "badge-danger" : state.narrativeRegime === "compounding" ? "badge-positive" : "",
    });
  }
  if (badges.length === 0) return <span className="muted">·</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {badges.map((b) => (
        <span key={b.label} className={`badge ${b.tone}`} title={b.title} style={{ fontSize: 10 }}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

export function DecisionFeed({ records }: { records: readonly DecisionRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="empty">
        No decisions recorded yet. The hash-chained feed fills as the desk acts.
      </p>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th className="num">Seq</th>
          <th>Time</th>
          <th>Action</th>
          <th>Class</th>
          <th>Regime</th>
          <th className="num">Edge</th>
          <th className="num">Intents</th>
          <th>Output</th>
          <th>Hash</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <Fragment key={record.seq}>
            <tr>
              <td className="num">{record.seq}</td>
              <td>{formatClock(record.ts)}</td>
              <td>{record.action}</td>
              <td>{record.radarClass ? <ClassBadge signalClass={record.radarClass} /> : <span className="muted">·</span>}</td>
              <td><RegimeBadges state={record.state} /></td>
              <td className="num">{formatBpsSigned(record.edgeBps)}</td>
              <td className="num">{record.intents.length}</td>
              <td>{record.simulated ? <SimBadge /> : <span className="badge badge-ok">APPROVED OUTPUT</span>}</td>
              <td className="muted">{record.hash.slice(0, 10)}…</td>
            </tr>
            <tr className="decision-why-row">
              <td colSpan={9} className="decision-why">{explainDecision(record)}</td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
