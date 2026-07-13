/**
 * Read-model schema for the analyst layer. A flat projection of already-hash-chained ledger
 * + radar + grade data. Built offline by materialize.ts; served READ-ONLY by db.ts. No part
 * of the decision path reads or writes these tables.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS fixtures (
  fixture_id TEXT PRIMARY KEY,
  generated_at_msg_id TEXT,
  final_home INTEGER,
  final_away INTEGER,
  clv_n INTEGER,
  clv_mean_bps INTEGER,
  clv_pct_positive REAL,
  brier REAL,
  brier_reliability REAL,
  pnl_units INTEGER,
  pnl_simulated INTEGER
);

CREATE TABLE IF NOT EXISTS decisions (
  fixture_id TEXT,
  seq INTEGER,
  trigger_msg_id TEXT,
  trigger_hash TEXT,
  trigger_network TEXT,
  ts INTEGER,
  action TEXT,
  radar_class TEXT,
  halt_reason TEXT,
  minute INTEGER,
  home_score INTEGER,
  away_score INTEGER,
  home_reds INTEGER,
  away_reds INTEGER,
  tissue_prob_bps INTEGER,
  market_prob_bps INTEGER,
  edge_bps INTEGER,
  open_intents INTEGER,
  realized_pnl_units INTEGER,
  drawdown_units INTEGER,
  n_intents INTEGER,
  hash TEXT,
  prev_hash TEXT,
  simulated INTEGER,
  PRIMARY KEY (fixture_id, seq)
);

CREATE TABLE IF NOT EXISTS radar_events (
  fixture_id TEXT,
  idx INTEGER,
  market TEXT,
  signal_class TEXT,
  trigger_kind TEXT,
  event_ts INTEGER,
  reaction_latency_ms INTEGER,
  magnitude_bps INTEGER,
  PRIMARY KEY (fixture_id, idx)
);

CREATE TABLE IF NOT EXISTS signal_class_stats (
  fixture_id TEXT,
  signal_class TEXT,
  n INTEGER,
  hit_rate REAL,
  mean_clv_bps INTEGER,
  PRIMARY KEY (fixture_id, signal_class)
);

CREATE INDEX IF NOT EXISTS idx_decisions_fixture ON decisions(fixture_id, seq);
CREATE INDEX IF NOT EXISTS idx_radar_class ON radar_events(signal_class);
`;
