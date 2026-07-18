import { createRequire } from "node:module";

// Load the `node:sqlite` built-in at runtime via require — bypasses bundler/test transforms
// that don't yet recognize this newer Node builtin (vitest/Vite strip the `node:` prefix).
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * READ-ONLY database accessor for the analyst layer. The connection is opened with
 * `readOnly: true` — read-only BY CONSTRUCTION, not by convention. Any write attempted
 * through this handle throws at the SQLite layer ("attempt to write a readonly database"),
 * which is exactly what the read-only enforcement test asserts. There is deliberately no
 * write method on this class.
 */

export interface DecisionRow {
  fixture_id: string;
  seq: number;
  trigger_msg_id: string;
  trigger_hash: string;
  trigger_network: string;
  ts: number;
  action: string;
  radar_class: string | null;
  halt_reason: string | null;
  minute: number;
  home_score: number;
  away_score: number;
  edge_bps: number;
  tissue_prob_bps: number;
  market_prob_bps: number;
  n_intents: number;
  open_intents: number;
  realized_pnl_units: number;
  drawdown_units: number;
  hash: string;
  prev_hash: string;
}

export interface SignalClassStatRow {
  signal_class: string;
  fixture_id: string | null;
  n_signals: number;
  mean_reaction_latency_ms: number | null;
  mean_magnitude_bps: number | null;
  n_decisions: number;
  hit_rate: number | null;
  mean_clv_bps: number | null;
}

export class ReadOnlyLedgerDb {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(path: string) {
    // The one line that makes this read-only by construction.
    this.db = new DatabaseSync(path, { readOnly: true });
  }

  close(): void {
    this.db.close();
  }

  /** Escape hatch used ONLY by the read-only enforcement test to prove writes throw. */
  attemptRawWrite(sql: string): void {
    this.db.exec(sql);
  }

  getRecentDecisions(fixtureId: string | undefined, limit: number): DecisionRow[] {
    const lim = Math.max(1, Math.min(200, Math.floor(limit) || 20));
    if (fixtureId) {
      return this.db
        .prepare(`SELECT * FROM decisions WHERE fixture_id = ? ORDER BY seq DESC LIMIT ?`)
        .all(fixtureId, lim) as unknown as DecisionRow[];
    }
    return this.db
      .prepare(`SELECT * FROM decisions ORDER BY ts DESC, seq DESC LIMIT ?`)
      .all(lim) as unknown as DecisionRow[];
  }

  queryLedgerByFixture(fixtureId: string): DecisionRow[] {
    return this.db
      .prepare(`SELECT * FROM (SELECT * FROM decisions WHERE fixture_id = ? ORDER BY seq DESC LIMIT 500) ORDER BY seq ASC`)
      .all(fixtureId) as unknown as DecisionRow[];
  }

  getSignalClassStats(signalClass: string | undefined, fixtureId: string | undefined): SignalClassStatRow[] {
    const where: string[] = [];
    const params: string[] = [];
    if (signalClass) {
      where.push("re.signal_class = ?");
      params.push(signalClass);
    }
    if (fixtureId) {
      where.push("re.fixture_id = ?");
      params.push(fixtureId);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // Radar-event side: counts + latency/magnitude per class.
    const radar = this.db
      .prepare(
        `SELECT re.signal_class AS signal_class,
                ${fixtureId ? "re.fixture_id" : "NULL"} AS fixture_id,
                COUNT(*) AS n_signals,
                AVG(re.reaction_latency_ms) AS mean_reaction_latency_ms,
                AVG(re.magnitude_bps) AS mean_magnitude_bps
         FROM radar_events re ${whereSql}
         GROUP BY re.signal_class`,
      )
      .all(...params) as Array<{ signal_class: string; fixture_id: string | null; n_signals: number; mean_reaction_latency_ms: number | null; mean_magnitude_bps: number | null }>;

    return radar.map((r) => {
      const grade = this.gradeForClass(r.signal_class, fixtureId);
      const decisions = this.decisionCountForClass(r.signal_class, fixtureId);
      return {
        signal_class: r.signal_class,
        fixture_id: r.fixture_id,
        n_signals: r.n_signals,
        mean_reaction_latency_ms: r.mean_reaction_latency_ms == null ? null : Math.round(r.mean_reaction_latency_ms),
        mean_magnitude_bps: r.mean_magnitude_bps == null ? null : Math.round(r.mean_magnitude_bps),
        n_decisions: decisions,
        hit_rate: grade?.hit_rate ?? null,
        mean_clv_bps: grade?.mean_clv_bps ?? null,
      };
    });
  }

  private gradeForClass(signalClass: string, fixtureId: string | undefined): { hit_rate: number; mean_clv_bps: number } | null {
    const sql = fixtureId
      ? `SELECT AVG(hit_rate) AS hit_rate, AVG(mean_clv_bps) AS mean_clv_bps FROM signal_class_stats WHERE signal_class = ? AND fixture_id = ?`
      : `SELECT AVG(hit_rate) AS hit_rate, AVG(mean_clv_bps) AS mean_clv_bps FROM signal_class_stats WHERE signal_class = ?`;
    const params = fixtureId ? [signalClass, fixtureId] : [signalClass];
    const row = this.db.prepare(sql).get(...params) as { hit_rate: number | null; mean_clv_bps: number | null } | undefined;
    if (!row || row.hit_rate == null) return null;
    return { hit_rate: row.hit_rate, mean_clv_bps: Math.round(row.mean_clv_bps ?? 0) };
  }

  /**
   * "Have we seen this pattern before?" — real, explainable pattern recall over the
   * read-only projection. This is deliberately NOT vector/embedding search: there is no
   * embedding model wired into this project, and fabricating a "semantic similarity" claim
   * without a real embedding pipeline would be exactly the kind of unverifiable claim this
   * project refuses to make elsewhere (see the informed-flow/stale-quote adaptations in
   * SUBMISSION.md). Similarity here is structured and auditable: same radar class (or same
   * action when the reference has none), match-minute within tolerance, and edge magnitude
   * within tolerance — ranked by combined distance. Every row returned is a real past
   * decision with its own hash-chain citation, same as every other tool here.
   */
  findSimilarDecisions(
    fixtureId: string,
    seq: number,
    opts: { minuteToleranceMin?: number; edgeToleranceBps?: number; limit?: number } = {},
  ): DecisionRow[] {
    const reference = this.db
      .prepare(`SELECT * FROM decisions WHERE fixture_id = ? AND seq = ?`)
      .get(fixtureId, seq) as DecisionRow | undefined;
    if (!reference) return [];
    const minuteTolerance = Math.max(0, opts.minuteToleranceMin ?? 10);
    const edgeTolerance = Math.max(0, opts.edgeToleranceBps ?? 100);
    const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 10)));
    const classFilter = reference.radar_class !== null
      ? "d.radar_class = ?"
      : "d.radar_class IS NULL AND d.action = ?";
    const classParam = reference.radar_class !== null ? reference.radar_class : reference.action;
    return this.db
      .prepare(
        `SELECT * FROM decisions d
         WHERE ${classFilter}
           AND NOT (d.fixture_id = ? AND d.seq = ?)
           AND ABS(d.minute - ?) <= ?
           AND ABS(d.edge_bps - ?) <= ?
         ORDER BY ABS(d.minute - ?) + ABS(d.edge_bps - ?) ASC, d.ts DESC
         LIMIT ?`,
      )
      .all(
        classParam,
        fixtureId, seq,
        reference.minute, minuteTolerance,
        reference.edge_bps, edgeTolerance,
        reference.minute, reference.edge_bps,
        limit,
      ) as unknown as DecisionRow[];
  }

  private decisionCountForClass(signalClass: string, fixtureId: string | undefined): number {
    const sql = fixtureId
      ? `SELECT COUNT(*) AS n FROM decisions WHERE radar_class = ? AND fixture_id = ?`
      : `SELECT COUNT(*) AS n FROM decisions WHERE radar_class = ?`;
    const params = fixtureId ? [signalClass, fixtureId] : [signalClass];
    const row = this.db.prepare(sql).get(...params) as { n: number };
    return row.n;
  }
}
