import type { CommitmentTimelineRow } from "@/lib/data/types";
import { formatClock } from "@/lib/format";

function short(value: string): string {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function CommitmentTimeline({ rows, network }: { rows: readonly CommitmentTimelineRow[]; network: "devnet" | "mainnet" }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        No on-chain commitment yet. The pre-match snapshot anchors as soon as the desk has
        priced the opening market; periodic checkpoints follow every N decisions
        (policy.exec.checkpoint_interval_decisions).
      </p>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>Time</th><th>Kind</th><th>Status</th><th>Hash</th><th>Evidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.kind}:${row.seq ?? i}`}>
              <td>{formatClock(row.submittedAt)}</td>
              <td>{row.kind === "pre-match" ? "Pre-Match (\"Proof of Edge\")" : `Checkpoint · seq ${row.seq}`}</td>
              <td>
                <span className={`badge ${row.status === "confirmed" ? "badge-ok" : "badge-danger"}`}>
                  {row.status.toUpperCase()}
                </span>
              </td>
              <td className="mono" title={row.hash}>{short(row.hash)}</td>
              <td>
                {row.txSig ? (
                  <a
                    className="evidence-link"
                    href={`https://explorer.solana.com/tx/${row.txSig}${network === "devnet" ? "?cluster=devnet" : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                ) : row.error ? (
                  <span className="danger-text" title={row.error}>{row.error}</span>
                ) : (
                  <span className="muted">Submitting…</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
