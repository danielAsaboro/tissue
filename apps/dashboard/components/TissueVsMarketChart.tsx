"use client";

import { useState } from "react";
import type { TissueVsMarketSeries } from "@/lib/data/types";
import { formatBpsPct } from "@/lib/format";

const W = 720;
const H = 240;
const PAD = 32;

/** Tissue's independent price vs the market's, one line each, plotted across every decision
 *  this fixture made, in order (X). Y is implied probability (0-100%). Hover any point on the
 *  chart to inspect the exact values at that decision. */
export function TissueVsMarketChart({ series }: { series: TissueVsMarketSeries }) {
  const { points } = series;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="empty">No pricing points yet.</p>;
  }

  const values = points.flatMap((p) => [p.tissueProbBps, p.marketProbBps]);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const spanY = maxY - minY || 1;
  const n = points.length;

  const xAt = (i: number): number => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const yAt = (v: number): number => H - PAD - ((v - minY) * (H - 2 * PAD)) / spanY;

  const toLine = (key: "tissueProbBps" | "marketProbBps"): string =>
    points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join(" ");

  function indexFromClientX(svg: SVGSVGElement, clientX: number): number {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    const fraction = (relX - PAD) / Math.max(1, W - 2 * PAD);
    return Math.min(n - 1, Math.max(0, Math.round(fraction * (n - 1))));
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${series.marketLabel} ${series.selectionLabel}: tissue probability vs market probability, by decision sequence`}
        onMouseMove={(e) => setHoverIndex(indexFromClientX(e.currentTarget, e.clientX))}
        onMouseLeave={() => setHoverIndex(null)}
        style={{ cursor: "crosshair" }}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--panel-2)" stroke="var(--line)" />
        <polyline fill="none" stroke="var(--muted)" strokeWidth={1.5} points={toLine("marketProbBps")} />
        <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={toLine("tissueProbBps")} />
        {hovered && hoverIndex !== null ? (
          <g>
            <line x1={xAt(hoverIndex)} y1={PAD} x2={xAt(hoverIndex)} y2={H - PAD} stroke="var(--line)" strokeDasharray="3 3" />
            <circle cx={xAt(hoverIndex)} cy={yAt(hovered.tissueProbBps)} r={3.5} fill="var(--accent)" />
            <circle cx={xAt(hoverIndex)} cy={yAt(hovered.marketProbBps)} r={3.5} fill="var(--muted)" />
          </g>
        ) : null}
      </svg>
      <div style={{ minHeight: 20, fontSize: 12, margin: "6px 0" }}>
        {hovered ? (
          <span>
            <strong>Minute {hovered.minute}</strong>
            <span className="muted"> · msg {hovered.msgId} — </span>
            Tissue <strong style={{ color: "var(--accent)" }}>{formatBpsPct(hovered.tissueProbBps)}</strong>
            {" · "}
            Market <strong>{formatBpsPct(hovered.marketProbBps)}</strong>
          </span>
        ) : (
          <span className="muted">Hover the chart to inspect any decision&apos;s exact prices.</span>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <span className="swatch" style={{ background: "var(--accent)" }} />
          Tissue (independent price)
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--muted)" }} />
          Market (last odds tick)
        </span>
        <span className="muted">
          Y: implied probability {formatBpsPct(minY)}–{formatBpsPct(maxY)} · X: this fixture&apos;s decisions, in order
        </span>
      </div>
    </div>
  );
}
