import type { DecisionRecord } from "@tissue/shared";
import { formatBpsSigned, formatClock } from "@/lib/format";
import { ClassBadge } from "./ClassBadge";
import { SimBadge } from "./SimBadge";

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
          <th className="num">Edge</th>
          <th className="num">Intents</th>
          <th>Output</th>
          <th>Hash</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.seq}>
            <td className="num">{record.seq}</td>
            <td>{formatClock(record.ts)}</td>
            <td>{record.action}</td>
            <td>{record.radarClass ? <ClassBadge signalClass={record.radarClass} /> : <span className="muted">·</span>}</td>
            <td className="num">{formatBpsSigned(record.edgeBps)}</td>
            <td className="num">{record.intents.length}</td>
            <td>{record.simulated ? <SimBadge /> : <span className="badge badge-ok">APPROVED OUTPUT</span>}</td>
            <td className="muted">{record.hash.slice(0, 10)}…</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
