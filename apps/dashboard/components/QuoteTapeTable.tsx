import type { QuoteTapeRow } from "@/lib/data/types";
import { formatClock, formatMilliOdds, formatUnits } from "@/lib/format";
import { SimBadge } from "./SimBadge";

export function QuoteTapeTable({ rows }: { rows: readonly QuoteTapeRow[] }) {
  if (rows.length === 0) {
    return <p className="empty">No quotes on the tape yet.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Market</th>
          <th>Selection</th>
          <th>Side</th>
          <th className="num">Price</th>
          <th className="num">Size</th>
          <th>Status</th>
          <th>Book</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.tsMs}-${i}`}>
            <td>{formatClock(row.tsMs)}</td>
            <td>{row.marketLabel}</td>
            <td>{row.selectionLabel}</td>
            <td>{row.side}</td>
            <td className="num">{formatMilliOdds(row.priceMilliOdds)}</td>
            <td className="num">{formatUnits(row.sizeUnits)}</td>
            <td>{row.status}</td>
            <td>{row.simulated ? <SimBadge /> : <span className="muted">real</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
