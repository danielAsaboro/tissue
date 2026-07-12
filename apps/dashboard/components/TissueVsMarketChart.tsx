import type { TissueVsMarketSeries } from "@/lib/data/types";
import { formatBpsPct } from "@/lib/format";

const W = 720;
const H = 240;
const PAD = 32;

export function TissueVsMarketChart({ series }: { series: TissueVsMarketSeries }) {
  const { points } = series;
  if (points.length === 0) {
    return <p className="empty">No pricing points yet.</p>;
  }

  const values = points.flatMap((p) => [p.tissueProbBps, p.marketProbBps]);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const spanY = maxY - minY || 1;
  const n = points.length;

  const xAt = (i: number): number =>
    PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const yAt = (v: number): number =>
    H - PAD - ((v - minY) * (H - 2 * PAD)) / spanY;

  const toLine = (key: "tissueProbBps" | "marketProbBps"): string =>
    points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${series.marketLabel} ${series.selectionLabel}: tissue probability vs market probability`}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--panel-2)" stroke="var(--line)" />
        <polyline fill="none" stroke="var(--muted)" strokeWidth={1.5} points={toLine("marketProbBps")} />
        <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={toLine("tissueProbBps")} />
      </svg>
      <div className="chart-legend">
        <span>
          <span className="swatch" style={{ background: "var(--accent)" }} />
          Tissue
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--muted)" }} />
          Market
        </span>
        <span className="muted">
          range {formatBpsPct(minY)} – {formatBpsPct(maxY)}
        </span>
      </div>
    </div>
  );
}
