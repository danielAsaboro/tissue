import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AnalystExport } from "@tissue/shared";
import { SCHEMA_SQL } from "./schema.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Materialize the read-model SQLite from AnalystExport JSON files. This is the ONE writer in
 * the analyst layer, run offline. It reads already-hash-chained, already-decided data (the
 * decision path wrote the exports) and projects it into flat tables. It never touches the
 * ledger, policy, or any decision module. The SERVING layer (db.ts) opens read-only.
 */

export function materializeExports(dbPath: string, exports: readonly AnalystExport[]): void {
  const db = new DatabaseSync(dbPath); // read-write: this is the projection builder
  try {
    db.exec(SCHEMA_SQL);
    db.exec("DELETE FROM decisions; DELETE FROM radar_events; DELETE FROM signal_class_stats; DELETE FROM fixtures;");

    const insFixture = db.prepare(
      `INSERT OR REPLACE INTO fixtures (fixture_id, generated_at_msg_id, final_home, final_away, clv_n, clv_mean_bps, clv_pct_positive, brier, brier_reliability, pnl_units, pnl_simulated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insDecision = db.prepare(
      `INSERT OR REPLACE INTO decisions (fixture_id, seq, trigger_msg_id, trigger_hash, trigger_network, ts, action, radar_class, halt_reason, minute, home_score, away_score, home_reds, away_reds, tissue_prob_bps, market_prob_bps, edge_bps, open_intents, realized_pnl_units, drawdown_units, n_intents, hash, prev_hash, simulated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insRadar = db.prepare(
      `INSERT OR REPLACE INTO radar_events (fixture_id, idx, market, signal_class, trigger_kind, event_ts, reaction_latency_ms, magnitude_bps)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    const insStat = db.prepare(
      `INSERT OR REPLACE INTO signal_class_stats (fixture_id, signal_class, n, hit_rate, mean_clv_bps) VALUES (?,?,?,?,?)`,
    );

    for (const ex of exports) {
      insFixture.run(
        ex.fixtureId, ex.generatedAtMsgId, ex.finalScore.home, ex.finalScore.away,
        ex.grade.clv.n, ex.grade.clv.meanClvBps, ex.grade.clv.pctPositive,
        ex.grade.brier.brier, ex.grade.brier.reliability, ex.grade.pnl.realizedUnits,
        ex.grade.pnl.simulated ? 1 : 0,
      );
      for (const d of ex.decisions) {
        insDecision.run(
          ex.fixtureId, d.seq, d.triggerMsgId, d.triggerHash, d.triggerNetwork, d.ts, d.action,
          d.radarClass ?? null, d.haltReason ?? null, d.state.minute, d.state.homeScore, d.state.awayScore,
          d.state.homeReds, d.state.awayReds, d.tissueProb, d.marketProb, d.edgeBps,
          d.state.exposure.openIntents, d.state.exposure.realizedPnlUnits, d.state.exposure.drawdownUnits,
          d.intents.length, d.hash, d.prevHash, d.simulated ? 1 : 0,
        );
      }
      ex.radarEvents.forEach((r, idx) => {
        insRadar.run(
          ex.fixtureId, idx, r.marketKey.market, r.signalClass, r.triggerEvent.kind,
          r.eventTs, r.reactionLatencyMs ?? null, r.magnitudeBps,
        );
      });
      for (const s of ex.grade.perClass) {
        insStat.run(ex.fixtureId, s.signalClass, s.n, s.hitRate, s.meanClvBps);
      }
    }
  } finally {
    db.close();
  }
}

/** Read every `*.analyst.json` in a directory into AnalystExport objects. */
export function readExportsDir(dir: string): AnalystExport[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".analyst.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as AnalystExport);
}
