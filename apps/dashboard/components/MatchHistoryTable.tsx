import Link from "next/link";
import type { MatchSummary } from "@/lib/data/types";
import { teamFlag } from "@/lib/flags";
import { formatBpsSigned, formatFractionPct, formatMatchDate } from "@/lib/format";

/** Win := this fixture's quotes beat the closing line on average — the same CLV win-rate
 *  yardstick Scoreboard uses, pooled per fixture instead of across the whole desk. */
function ResultBadge({ clvN, pctPositive }: { clvN: number; pctPositive: number }) {
  if (clvN === 0) return <span className="muted">—</span>;
  const win = pctPositive >= 0.5;
  return <span className={`badge ${win ? "badge-positive" : "badge-danger"}`}>{win ? "WIN" : "LOSS"}</span>;
}

export function MatchHistoryTable({ matches }: { matches: readonly MatchSummary[] }) {
  if (matches.length === 0) {
    return <p className="empty">No fixtures captured yet.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Match</th>
          <th>Date</th>
          <th className="num">Score</th>
          <th className="num">Decisions</th>
          <th className="num">Mean CLV</th>
          <th className="num">Win rate</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match, i) => (
          <tr key={match.fixtureId}>
            <td className="num">{i + 1}</td>
            <td>
              <Link href={`/decisions?fixtureId=${encodeURIComponent(match.fixtureId)}`}>
                {match.meta ? (
                  <>
                    {teamFlag(match.meta.homeTeam)} {match.meta.homeTeam} vs {match.meta.awayTeam}{" "}
                    {teamFlag(match.meta.awayTeam)}
                  </>
                ) : (
                  `Fixture ${match.fixtureId}`
                )}
              </Link>
            </td>
            <td>{match.meta ? formatMatchDate(match.meta.kickoff) : <span className="muted">—</span>}</td>
            <td className="num">{match.finalScore.home}–{match.finalScore.away}</td>
            <td className="num">{match.decisions}</td>
            <td className="num">{match.clvN > 0 ? `${formatBpsSigned(match.meanClvBps)} bps` : <span className="muted">—</span>}</td>
            <td className="num">{match.clvN > 0 ? formatFractionPct(match.pctPositive) : <span className="muted">—</span>}</td>
            <td><ResultBadge clvN={match.clvN} pctPositive={match.pctPositive} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
