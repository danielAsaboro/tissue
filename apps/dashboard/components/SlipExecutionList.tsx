import type { VenueExecutionRow } from "@/lib/data/types";
import { formatClock } from "@/lib/format";

function short(value: string): string {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function marketLabel(row: VenueExecutionRow): string {
  const { market, lineTimes10 } = row.marketKey;
  return lineTimes10 !== undefined ? `${market}@${lineTimes10 / 10}` : market;
}

function stakeLabel(atomicUnits: number): string {
  return `${(atomicUnits / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens`;
}

function explorerTx(signature: string, network: "devnet" | "mainnet"): string {
  return `https://explorer.solana.com/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

export function VenueExecutionList({ rows, network }: { rows: readonly VenueExecutionRow[]; network: "devnet" | "mainnet" }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        No decision has risked real capital through an enabled venue adapter yet. Slip is
        currently the only adapter and is off by default (policy.exec.slip.enabled).
      </p>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th scope="col" className="num">Seq</th><th scope="col">Venue</th><th scope="col">Time</th><th scope="col">Market</th><th scope="col">Selection</th><th scope="col" className="num">Edge</th><th scope="col" className="num">Stake</th><th scope="col">Execution</th><th scope="col">Lifecycle</th><th scope="col">Evidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.venue}:${row.decisionSeq}:${row.marketKey.market}:${row.marketKey.lineTimes10 ?? ""}`}>
              <td className="num">{row.decisionSeq}</td>
              <td>{row.venue}</td>
              <td>{formatClock(row.submittedAt)}</td>
              <td>{marketLabel(row)}</td>
              <td>{row.side ? `${row.side} ` : ""}{row.selection}</td>
              <td className="num" title={row.venueBreakevenProbBps === undefined ? "TxLINE consensus edge" : `TxLINE edge ${row.edgeBps}bps · Slip break-even ${row.venueBreakevenProbBps}bps · projected payout ${row.projectedPayoutAtomic ?? "—"} atomic units`}>
                {row.venueEdgeBps === undefined ? `${row.edgeBps}bps` : `${row.venueEdgeBps}bps venue`}
              </td>
              <td className="num" title={`${row.sizeUnits} atomic units`}>{stakeLabel(row.sizeUnits)}</td>
              <td>
                <span className={`badge ${row.status === "confirmed" ? "badge-ok" : row.status === "failed" ? "badge-danger" : ""}`}>
                  {row.status.toUpperCase()}
                </span>
              </td>
              <td>
                <span className={`badge ${row.lifecycleStatus === "claimed" || row.lifecycleStatus === "refunded" ? "badge-ok" : row.lifecycleStatus === "attention-required" ? "badge-danger" : ""}`}>
                  {(row.lifecycleStatus ?? "—").toUpperCase()}
                </span>
                {row.lifecycleError ? <span className="danger-text" title={row.lifecycleError}> {row.lifecycleError}</span> : null}
              </td>
              <td>
                {row.submissionTxSig && row.venue === "slip" ? (
                  <span>
                    <a className="evidence-link" href={explorerTx(row.submissionTxSig, network)} target="_blank" rel="noreferrer">Submit ↗</a>
                    {row.settlementTxSig ? <> · <a className="evidence-link" href={explorerTx(row.settlementTxSig, network)} target="_blank" rel="noreferrer">Settle ↗</a></> : null}
                    {row.claimTxSig ? <> · <a className="evidence-link" href={explorerTx(row.claimTxSig, network)} target="_blank" rel="noreferrer">Claim ↗</a></> : null}
                    {row.voidTxSig ? <> · <a className="evidence-link" href={explorerTx(row.voidTxSig, network)} target="_blank" rel="noreferrer">Void ↗</a></> : null}
                    {row.refundTxSig ? <> · <a className="evidence-link" href={explorerTx(row.refundTxSig, network)} target="_blank" rel="noreferrer">Refund ↗</a></> : null}
                  </span>
                ) : row.venueMarketId ? (
                  <span className="muted mono" title={row.venueMarketId}>market {short(row.venueMarketId)}</span>
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
