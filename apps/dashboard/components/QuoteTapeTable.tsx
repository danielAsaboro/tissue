import type { QuoteTapeRow } from "@/lib/data/types";
import { formatClock, formatMilliOdds, formatUnits } from "@/lib/format";
import { SimBadge } from "./SimBadge";

function shortHash(hash: string | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

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
          <th>Mode</th>
          <th>Receipt</th>
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
            <td>{row.simulated ? <SimBadge /> : <span className="badge badge-ok">LIVE OUTPUT</span>}</td>
            <td>
              <span className="muted" title={row.decisionHash} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                {shortHash(row.decisionHash)}
              </span>
              {row.explorerUrl ? (
                <>
                  {" "}
                  <a href={row.explorerUrl} target="_blank" rel="noreferrer" className="badge badge-ok">
                    proof tx
                  </a>
                </>
              ) : (
                <>
                  {" "}
                  <span className="muted" style={{ fontSize: 11 }} title={`TxLINE proof messageId: ${row.proofMessageId}`}>
                    (no on-chain tx recorded)
                  </span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
