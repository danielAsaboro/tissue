import type { BacktestSummary } from "@/lib/data/types";
import { formatBpsSigned, formatClock, formatFractionPct, formatMilliOdds } from "@/lib/format";

const WIDTH = 720;
const HEIGHT = 200;
const PAD = 28;

function path(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** Self-contained inline SVG — same "no charting dependency" discipline as EquityCurve.tsx. */
function WinRateCurve({ cumulativeWinRate }: { cumulativeWinRate: readonly number[] }) {
  if (cumulativeWinRate.length < 2) {
    return <p className="empty">Waiting for enough priced quotes to plot a curve.</p>;
  }
  const plotW = WIDTH - PAD * 2;
  const plotH = HEIGHT - PAD * 2;
  const xFor = (i: number) => PAD + (i / (cumulativeWinRate.length - 1)) * plotW;
  const yFor = (rate: number) => PAD + plotH - rate * plotH;
  const halfY = yFor(0.5);
  const points = cumulativeWinRate.map((rate, i) => ({ x: xFor(i), y: yFor(rate) }));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Cumulative win rate">
      <line x1={PAD} y1={halfY} x2={WIDTH - PAD} y2={halfY} stroke="var(--line)" strokeDasharray="4 4" />
      <path d={path(points)} fill="none" stroke="var(--accent, #4a9eff)" strokeWidth={1.5} />
      <circle cx={points[points.length - 1]!.x} cy={points[points.length - 1]!.y} r={3} fill="var(--accent, #4a9eff)" />
    </svg>
  );
}

export function ScoreboardView({ summary }: { summary: BacktestSummary }) {
  if (!summary.available || !summary.samples || !summary.streaks) {
    return (
      <section className="panel">
        <h2>Scoreboard</h2>
        <p className="empty">{summary.reason ?? "Waiting for a priced fixture."}</p>
      </section>
    );
  }

  const { samples, cumulativeWinRate = [], strikeRate = 0, streaks, fixtureId } = summary;
  const recent = samples.slice(-100);

  return (
    <section className="panel">
      <h2>
        Scoreboard{" "}
        <span className="badge">{fixtureId}</span>
      </h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Every quote this fixture priced, in order, graded against the close (win := beat the
        closing line). Strike rate is the pooled fraction of wins across every sample, not an
        average of per-fixture averages. If this fixture is still live, numbers are provisional
        and keep moving until the match actually closes.
      </p>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="metric">
          <span className="label">Strike rate</span>
          <span className="value">{formatFractionPct(strikeRate)}</span>
        </div>
        <div className="metric">
          <span className="label">Priced quotes</span>
          <span className="value">{samples.length}</span>
        </div>
        <div className="metric">
          <span className="label">Longest win streak</span>
          <span className="value">{streaks.longestWinStreak}</span>
        </div>
        <div className="metric">
          <span className="label">Longest losing streak</span>
          <span className="value">{streaks.longestLossStreak}</span>
        </div>
        <div className="metric">
          <span className="label">Current streak</span>
          <span className="value">
            {streaks.currentStreak.kind === "none" ? (
              "—"
            ) : (
              <>
                {streaks.currentStreak.length}{" "}
                <span className={`badge ${streaks.currentStreak.kind === "win" ? "badge-positive" : "badge-danger"}`}>
                  {streaks.currentStreak.kind === "win" ? "wins" : "losses"}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <WinRateCurve cumulativeWinRate={cumulativeWinRate} />

      <div style={{ marginTop: 16, maxHeight: 360, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Market</th>
              <th>Selection</th>
              <th className="num">Tissue</th>
              <th className="num">Close</th>
              <th className="num">CLV</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((sample) => (
              <tr key={`${sample.seq}-${sample.msgId}`}>
                <td>{formatClock(sample.ts)}</td>
                <td>{sample.marketKey}</td>
                <td>{sample.selection}</td>
                <td className="num">{formatMilliOdds(sample.quoteMilliOdds)}</td>
                <td className="num">{formatMilliOdds(sample.closingMilliOdds)}</td>
                <td className="num">{formatBpsSigned(sample.clvBps)} bps</td>
                <td>
                  <span className={`badge ${sample.win ? "badge-positive" : "badge-danger"}`}>
                    {sample.win ? "win" : "loss"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {samples.length > recent.length ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Showing the most recent {recent.length} of {samples.length} priced quotes.
        </p>
      ) : null}
    </section>
  );
}
