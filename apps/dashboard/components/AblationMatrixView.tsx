import type { AblationMatrixSummary } from "@/lib/data/types";
import { formatBpsSigned } from "@/lib/format";

const REGIME_LABELS: Record<string, string> = {
  stoppage: "Stoppage-time",
  mutual_danger: "Mutual-danger",
  narrative: "Narrative regime",
  informed_flow: "Informed-flow",
  stale_quote: "Stale-quote decay",
};

export function AblationMatrixView({ summary }: { summary: AblationMatrixSummary }) {
  if (!summary.available || !summary.baseline || !summary.rows) {
    return (
      <section className="panel">
        <h2>Regime ablation matrix</h2>
        <p className="empty">{summary.reason ?? "Waiting for a priced fixture."}</p>
      </section>
    );
  }

  const { baseline, rows } = summary;

  return (
    <section className="panel">
      <h2>Regime ablation matrix</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        The arena above answers "do the regimes help, bundled?" — this isolates each flagged
        heuristic one at a time against the SAME neutralized baseline, so each regime's
        contribution is a separately measured number, not a guess folded into the total.
      </p>

      <table>
        <thead>
          <tr>
            <th>Regime (isolated)</th>
            <th className="num">CLV n</th>
            <th className="num">Mean CLV</th>
            <th className="num">Brier</th>
            <th className="num">CLV edge vs baseline</th>
            <th className="num">Brier edge</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="muted">Baseline (every regime off)</td>
            <td className="num">{baseline.clvN}</td>
            <td className="num">{formatBpsSigned(baseline.meanClvBps)} bps</td>
            <td className="num">{baseline.brier.toFixed(4)}</td>
            <td className="num muted">—</td>
            <td className="num muted">—</td>
          </tr>
          {rows.map((row) => {
            const clvWinner = row.clvEdgeBps > 0 ? "positive" : row.clvEdgeBps < 0 ? "danger" : "";
            const brierWinner = row.brierEdge < 0 ? "positive" : row.brierEdge > 0 ? "danger" : "";
            return (
              <tr key={row.regime}>
                <td>{REGIME_LABELS[row.regime] ?? row.regime}</td>
                <td className="num">{row.clvN}</td>
                <td className="num">{formatBpsSigned(row.meanClvBps)} bps</td>
                <td className="num">{row.brier.toFixed(4)}</td>
                <td className="num">
                  <span className={`badge ${clvWinner ? `badge-${clvWinner}` : ""}`}>{formatBpsSigned(row.clvEdgeBps)} bps</span>
                </td>
                <td className="num">
                  <span className={`badge ${brierWinner ? `badge-${brierWinner}` : ""}`}>
                    {row.brierEdge > 0 ? "+" : ""}{row.brierEdge.toFixed(4)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
