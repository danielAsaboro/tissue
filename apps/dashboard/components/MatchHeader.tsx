import Link from "next/link";
import type { FixtureMeta } from "@tissue/shared";
import { teamFlag } from "@/lib/flags";
import { formatMatchDate } from "@/lib/format";

/** Real match identity for whichever fixture a page is currently showing — teams, flags, date
 *  — instead of a bare fixtureId. A compact strip, not a page title (pages keep their own
 *  h1/h2): every fixture-scoped page renders this so "which match is this?" never depends on
 *  reading a fixtureId out of raw JSON. meta is null when this fixture has no matching
 *  schedule entry (never fabricated); fixtureId still renders so the page isn't unlabeled. */
export function MatchHeader({ fixtureId, meta }: { fixtureId?: string; meta: FixtureMeta | null }) {
  return (
    <div className="match-header">
      <strong>
        {meta ? (
          <>
            {teamFlag(meta.homeTeam)} {meta.homeTeam} vs {meta.awayTeam} {teamFlag(meta.awayTeam)}
          </>
        ) : (
          fixtureId ? `Fixture ${fixtureId}` : "No fixture data available yet"
        )}
      </strong>
      {meta ? <span className="muted">{formatMatchDate(meta.kickoff)}</span> : null}
      {fixtureId ? (
        <Link href="/matches" className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          ← All matches
        </Link>
      ) : null}
    </div>
  );
}
