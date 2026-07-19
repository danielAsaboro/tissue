-- Tissue live-desk durable storage (Supabase Postgres).
-- Run once against the target project before starting the daemon with DATABASE_URL set.
--
-- One append-only table for every kind of live-runtime record the daemon used to keep as
-- JSONL files under CORPUS_DIR: corpus messages, the hash-chained decision ledger, policy
-- snapshots, on-chain proof/anchor evidence, pre-match commitments, checkpoint anchors, and
-- Slip venue executions. `kind` distinguishes the record type; `payload` holds the exact
-- same JSON shape the daemon already validates and serializes today.
--
-- Local backtesting/replay corpus (corpus/worldcup-2026/*, seeded fixtures, etc.) is
-- unaffected — that stays file-based and local, this table only backs the live daemon.

create table if not exists tissue_events (
  id bigserial primary key,
  kind text not null check (kind in (
    'corpus_message',
    'decision',
    'policy_snapshot',
    'anchor_evidence',
    'pre_match_commitment',
    'checkpoint_anchor',
    'venue_execution'
  )),
  fixture_id text,
  seq integer,
  hash text,
  prev_hash text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists tissue_events_kind_fixture_id_idx
  on tissue_events (kind, fixture_id, id);

-- Enforces the hash-chain append-only invariant at the DB level: each fixture's decision
-- sequence numbers must be unique (defense in depth alongside the in-process assertAppendOnly
-- check in liveDesk.ts).
create unique index if not exists tissue_events_decision_seq_uidx
  on tissue_events (fixture_id, seq)
  where kind = 'decision';
