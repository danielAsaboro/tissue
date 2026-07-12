import type { GradeSheet } from "@tissue/shared";
import { formatBpsSigned, formatFractionPct, formatMs, formatUnits } from "@/lib/format";

export function GradeSheetView({ sheet }: { sheet: GradeSheet }) {
  const { clv, brier, latency, perClass, pnl } = sheet;
  return (
    <div>
      <section className="panel">
        <h2>CLV distribution</h2>
        <div className="grid-2">
          <Metric label="Samples" value={String(clv.n)} />
          <Metric label="Mean CLV" value={`${formatBpsSigned(clv.meanClvBps)} bps`} />
          <Metric label="Median CLV" value={`${formatBpsSigned(clv.medianClvBps)} bps`} />
          <Metric label="P25 / P75" value={`${formatBpsSigned(clv.p25Bps)} / ${formatBpsSigned(clv.p75Bps)}`} />
          <Metric label="Positive" value={formatFractionPct(clv.pctPositive)} />
        </div>
      </section>

      <section className="panel">
        <h2>Brier score & calibration</h2>
        <div className="grid-2">
          <Metric label="Brier" value={brier.brier.toFixed(3)} />
          <Metric label="Reliability" value={brier.reliability.toFixed(3)} />
          <Metric label="Resolution" value={brier.resolution.toFixed(3)} />
          <Metric label="Uncertainty" value={brier.uncertainty.toFixed(3)} />
        </div>
        {brier.bins.length === 0 ? (
          <p className="empty">No calibration bins yet.</p>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th className="num">Predicted</th>
                <th className="num">Observed</th>
                <th className="num">Count</th>
              </tr>
            </thead>
            <tbody>
              {brier.bins.map((bin, i) => (
                <tr key={i}>
                  <td className="num">{formatFractionPct(bin.predictedProb)}</td>
                  <td className="num">{formatFractionPct(bin.observedFreq)}</td>
                  <td className="num">{bin.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Latency distribution</h2>
        {latency.length === 0 ? (
          <p className="empty">No latency samples yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th className="num">n</th>
                <th className="num">P10</th>
                <th className="num">P50</th>
                <th className="num">P90</th>
              </tr>
            </thead>
            <tbody>
              {latency.map((dist, i) => (
                <tr key={`${dist.market}-${i}`}>
                  <td>{dist.market}</td>
                  <td className="num">{dist.n}</td>
                  <td className="num">{formatMs(dist.p10Ms)}</td>
                  <td className="num">{formatMs(dist.p50Ms)}</td>
                  <td className="num">{formatMs(dist.p90Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Per-signal-class hit rates</h2>
        {perClass.length === 0 ? (
          <p className="empty">No per-class samples yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th className="num">n</th>
                <th className="num">Hit rate</th>
                <th className="num">Mean CLV</th>
              </tr>
            </thead>
            <tbody>
              {perClass.map((row) => (
                <tr key={row.signalClass}>
                  <td>{row.signalClass}</td>
                  <td className="num">{row.n}</td>
                  <td className="num">{formatFractionPct(row.hitRate)}</td>
                  <td className="num">{formatBpsSigned(row.meanClvBps)} bps</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>
          Realized PnL{" "}
          {pnl.simulated ? <span className="badge badge-sim">SIMULATED</span> : null}
        </h2>
        <div className="grid-2">
          <Metric label="Realized (units)" value={formatUnits(pnl.realizedUnits)} />
          <Metric label="Matched intents" value={String(pnl.matchedIntents)} />
          <Metric label="Settlement txs" value={String(pnl.settlementTxSigs.length)} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}
