import type { EquityCurvePoint } from "@/lib/data/types";

const WIDTH = 720;
const HEIGHT = 200;
const PAD = 28;

function path(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** Self-contained inline SVG — no charting dependency, same "no new infrastructure" discipline
 *  as the rest of the dashboard. Data is already-tracked ExposureSnapshot per decision
 *  (state/exposure.ts), just plotted instead of left in raw JSON. */
export function EquityCurve({ points }: { points: readonly EquityCurvePoint[] }) {
  if (points.length < 2) {
    return (
      <section className="panel">
        <h2>Equity curve</h2>
        <p className="empty">Waiting for enough decisions to plot a curve (simulated PnL, replay-only).</p>
      </section>
    );
  }

  const pnlValues = points.map((p) => p.realizedPnlUnits);
  const minPnl = Math.min(0, ...pnlValues);
  const maxPnl = Math.max(0, ...pnlValues);
  const span = maxPnl - minPnl || 1;

  const plotW = WIDTH - PAD * 2;
  const plotH = HEIGHT - PAD * 2;
  const xFor = (i: number) => PAD + (i / (points.length - 1)) * plotW;
  const yFor = (pnl: number) => PAD + plotH - ((pnl - minPnl) / span) * plotH;
  const zeroY = yFor(0);

  const pnlPoints = points.map((p, i) => ({ x: xFor(i), y: yFor(p.realizedPnlUnits) }));
  const last = points[points.length - 1]!;
  const peak = Math.max(...points.map((p) => p.peakEquityUnits));
  const maxDrawdown = Math.max(...points.map((p) => p.drawdownUnits));

  return (
    <section className="panel">
      <h2>Equity curve</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
        Realized PnL per decision (SIMULATED book — see the desk-wide simulated-fill
        disclaimer). Same ExposureSnapshot already embedded in every decision record, plotted
        instead of left in raw JSON.
      </p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Equity curve">
        <line x1={PAD} y1={zeroY} x2={WIDTH - PAD} y2={zeroY} stroke="var(--line)" strokeDasharray="4 4" />
        <path d={path(pnlPoints)} fill="none" stroke="var(--accent, #4a9eff)" strokeWidth={1.5} />
        <circle cx={pnlPoints[pnlPoints.length - 1]!.x} cy={pnlPoints[pnlPoints.length - 1]!.y} r={3} fill="var(--accent, #4a9eff)" />
      </svg>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="metric">
          <span className="label">Latest realized PnL</span>
          <span className="value">{last.realizedPnlUnits.toLocaleString()} units</span>
        </div>
        <div className="metric">
          <span className="label">Peak equity / max drawdown</span>
          <span className="value">{peak.toLocaleString()} / {maxDrawdown.toLocaleString()} units</span>
        </div>
      </div>
    </section>
  );
}
