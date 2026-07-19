import type { SlipExecutionRow } from "@/lib/data/types";
import { formatClock } from "@/lib/format";

function short(value: string): string {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function marketLabel(row: SlipExecutionRow): string {
  const { market, lineTimes10 } = row.marketKey;
  return lineTimes10 !== undefined ? `${market}@${lineTimes10 / 10}` : market;
}

export function SlipExecutionList({ rows, network }: { rows: readonly SlipExecutionRow[]; network: "devnet" | "mainnet" }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        No decision has risked real capital on Slip yet. This is off by default
        (policy.exec.slip.enabled) — the desk only trades here on an edge deliberately
        stricter than its ordinary quoting threshold.
      </p>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th className="num">Seq</th><th>Time</th><th>Market</th><th>Selection</th><th className="num">Edge</th><th className="num">Stake</th><th>Status</th><th>Evidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.decisionSeq}:${row.marketKey.market}:${row.marketKey.lineTimes10 ?? ""}`}>
              <td className="num">{row.decisionSeq}</td>
              <td>{formatClock(row.submittedAt)}</td>
              <td>{marketLabel(row)}</td>
              <td>{row.selection}</td>
              <td className="num">{row.edgeBps}bps</td>
              <td className="num">{row.sizeUnits}</td>
              <td>
                <span className={`badge ${row.status === "confirmed" ? "badge-ok" : row.status === "failed" ? "badge-danger" : ""}`}>
                  {row.status.toUpperCase()}
                </span>
              </td>
              <td>
                {row.buyTxSig ? (
                  <a
                    className="evidence-link"
                    href={`https://explorer.solana.com/tx/${row.buyTxSig}${network === "devnet" ? "?cluster=devnet" : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View buy tx ↗
                  </a>
                ) : row.market ? (
                  <span className="muted mono" title={row.market}>market {short(row.market)}</span>
                ) : row.error ? (
                  <span className="danger-text" title={row.error}>{row.error}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
