/** Real-world identity for a fixture — team names and kickoff time. Sourced from TxODDS'
 *  fixture-schedule metadata (a separate endpoint from the live score/odds feed, which never
 *  carries team names), attached to API responses by fixtureId. Absent (null) for a fixture
 *  this desk has data for but no matching schedule entry — never fabricated. */
export interface FixtureMeta {
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** ISO 8601 kickoff time. */
  readonly kickoff: string;
}
