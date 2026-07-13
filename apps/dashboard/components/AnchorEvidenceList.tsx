import type { AnchorEvidenceRow } from "@/lib/data/types";
import { formatClock } from "@/lib/format";

function short(value: string): string {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function AnchorEvidenceList({ rows, network }: { rows: readonly AnchorEvidenceRow[]; network: "devnet" | "mainnet" }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        Waiting for the first TxLINE odds proof. No verification result is shown until the
        proof endpoint and Solana program both accept a real message.
      </p>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>Time</th><th>Message</th><th>Method</th><th>Status</th><th>Root PDA</th><th>Evidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.messageId}:${row.method}`}>
              <td>{formatClock(row.ts)}</td>
              <td className="mono" title={row.messageId}>{short(row.messageId)}</td>
              <td>{row.method === "transaction" ? "Submitted tx" : "On-chain view"}</td>
              <td>
                <span className={`badge ${row.result ? "badge-ok" : "badge-danger"}`}>
                  {row.status.toUpperCase()}
                </span>
              </td>
              <td className="mono" title={row.rootPda}>{row.rootPda ? short(row.rootPda) : "—"}</td>
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
                  <span className="muted">Validated against program state</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
