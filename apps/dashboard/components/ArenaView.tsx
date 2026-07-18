import type { ArenaSummary } from "@/lib/data/types";
import { formatBpsSigned } from "@/lib/format";

export function ArenaView({ summary }: { summary: ArenaSummary }) {
  if (!summary.available || !summary.tissue || !summary.baseline) {
    return (
      <section className="panel">
        <h2>Strategy arena</h2>
        <p className="empty">{summary.reason ?? "Waiting for a priced fixture."}</p>
      </section>
    );
  }

  const { tissue, baseline, clvEdgeBps = 0, brierEdge = 0 } = summary;
  const clvWinner = clvEdgeBps > 0 ? "tissue" : clvEdgeBps < 0 ? "baseline" : "tie";
  const brierWinner = brierEdge < 0 ? "tissue" : brierEdge > 0 ? "baseline" : "tie"; // Brier: lower is better

  return (
    <section className="panel">
      <h2>
        Strategy arena{" "}
        <span className="badge">{summary.fixtureId}</span>
      </h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        The SAME feed through the SAME deterministic engine, twice: <strong>Tissue</strong>{" "}
        (every regime enabled) vs <strong>Baseline</strong> (every flagged heuristic
        neutralized to a no-op). Graded head-to-head with the same CLV/Brier grader —
        settled against the real market close, not asserted.
      </p>

      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th className="num">CLV n</th>
            <th className="num">Mean CLV</th>
            <th className="num">Brier</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tissue</td>
            <td className="num">{tissue.clvN}</td>
            <td className="num">{formatBpsSigned(tissue.meanClvBps)} bps</td>
            <td className="num">{tissue.brier.toFixed(4)}</td>
          </tr>
          <tr>
            <td>Baseline</td>
            <td className="num">{baseline.clvN}</td>
            <td className="num">{formatBpsSigned(baseline.meanClvBps)} bps</td>
            <td className="num">{baseline.brier.toFixed(4)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="metric">
          <span className="label">CLV edge (Tissue − Baseline)</span>
          <span className="value">
            {formatBpsSigned(clvEdgeBps)} bps{" "}
            <span className={`badge ${clvWinner === "tissue" ? "badge-positive" : clvWinner === "baseline" ? "badge-danger" : ""}`}>
              {clvWinner === "tie" ? "tie" : `${clvWinner} ahead`}
            </span>
          </span>
        </div>
        <div className="metric">
          <span className="label">Brier edge (lower is better)</span>
          <span className="value">
            {brierEdge > 0 ? "+" : ""}
            {brierEdge.toFixed(4)}{" "}
            <span className={`badge ${brierWinner === "tissue" ? "badge-positive" : brierWinner === "baseline" ? "badge-danger" : ""}`}>
              {brierWinner === "tie" ? "tie" : `${brierWinner} ahead`}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
