import postgres from "postgres";
import type { DecisionRecord, FeedMessage } from "@tissue/shared";
import type { AnchorEvidence } from "../exec/anchorLive.js";
import type { PreMatchCommitmentEvidence } from "../exec/preMatchCommit.js";
import type { CheckpointAnchorEvidence } from "../exec/periodicAnchor.js";
import type { VenueExecutionEvidence } from "../exec/venue.js";
import type { PolicySnapshotEntry } from "../config/policySnapshot.js";

/**
 * Durable storage for the LIVE desk (Supabase Postgres) — replaces the CORPUS_DIR JSONL
 * journals for anything the daemon writes at runtime, so decision/proof/execution history
 * survives a Railway restart instead of living only on the container's ephemeral disk.
 *
 * Local backtesting/replay corpus (ingest/corpus.ts, corpus/worldcup-2026/*) is untouched —
 * that stays file-based on purpose (see schema.sql header). This interface is injected into
 * LiveDesk so tests can swap in an in-memory fake (inMemoryLiveStore.ts) instead of needing a
 * real database connection.
 */
export interface LiveStore {
  appendLiveMessage(fixtureId: string, message: FeedMessage): Promise<void>;
  readLiveTape(fixtureId: string): Promise<FeedMessage[]>;
  liveTapeExists(fixtureId: string): Promise<boolean>;
  listFixtureIds(): Promise<string[]>;

  appendDecision(fixtureId: string, record: DecisionRecord): Promise<void>;
  readDecisions(fixtureId: string): Promise<DecisionRecord[]>;

  appendPolicySnapshotRow(entry: PolicySnapshotEntry): Promise<void>;
  readAllPolicySnapshotRows(): Promise<PolicySnapshotEntry[]>;
  readLastPolicySnapshotRow(): Promise<PolicySnapshotEntry | undefined>;

  appendAnchorEvidenceRow(evidence: AnchorEvidence): Promise<void>;
  readAllAnchorEvidenceRows(): Promise<AnchorEvidence[]>;

  appendPreMatchCommitmentRow(evidence: PreMatchCommitmentEvidence): Promise<void>;
  readAllPreMatchCommitmentRows(): Promise<PreMatchCommitmentEvidence[]>;

  appendCheckpointRow(evidence: CheckpointAnchorEvidence): Promise<void>;
  readAllCheckpointRows(): Promise<CheckpointAnchorEvidence[]>;

  appendVenueExecutionRow(evidence: VenueExecutionEvidence): Promise<void>;
  readAllVenueExecutionRows(): Promise<VenueExecutionEvidence[]>;

  close(): Promise<void>;
}

/**
 * Type-only cast, zero runtime effect (confirmed against a live probe table): the interpolated
 * value stays the real object at runtime, and the `::jsonb` cast tells Postgres to serialize it
 * server-side. postgres.js's parameter typing has no friendly overload for readonly domain
 * interfaces here, so this widens to `string` for TypeScript only — pre-stringifying with
 * JSON.stringify() ourselves would double-encode it (confirmed: produced a jsonb STRING
 * containing escaped JSON text instead of a jsonb object).
 */
function toJson(value: unknown): string {
  return value as unknown as string;
}

export function createPostgresLiveStore(databaseUrl: string): LiveStore {
  const sql = postgres(databaseUrl, { ssl: "require", max: 5, idle_timeout: 20 });

  return {
    async appendLiveMessage(fixtureId, message) {
      await sql`insert into tissue_events (kind, fixture_id, payload)
        values ('corpus_message', ${fixtureId}, ${toJson(message)}::jsonb)`;
    },
    async readLiveTape(fixtureId) {
      const rows = await sql`select payload from tissue_events
        where kind = 'corpus_message' and fixture_id = ${fixtureId} order by id`;
      return rows.map((row) => row.payload as FeedMessage);
    },
    async liveTapeExists(fixtureId) {
      const rows = await sql`select 1 from tissue_events
        where kind = 'corpus_message' and fixture_id = ${fixtureId} limit 1`;
      return rows.length > 0;
    },
    async listFixtureIds() {
      const rows = await sql`select distinct fixture_id from tissue_events
        where kind = 'corpus_message' and fixture_id is not null order by fixture_id`;
      return rows.map((row) => row.fixture_id as string);
    },

    async appendDecision(fixtureId, record) {
      await sql`insert into tissue_events (kind, fixture_id, seq, hash, prev_hash, payload)
        values ('decision', ${fixtureId}, ${record.seq}, ${record.hash}, ${record.prevHash}, ${toJson(record)}::jsonb)`;
    },
    async readDecisions(fixtureId) {
      const rows = await sql`select payload from tissue_events
        where kind = 'decision' and fixture_id = ${fixtureId} order by seq`;
      return rows.map((row) => row.payload as DecisionRecord);
    },

    async appendPolicySnapshotRow(entry) {
      await sql`insert into tissue_events (kind, payload) values ('policy_snapshot', ${toJson(entry)}::jsonb)`;
    },
    async readAllPolicySnapshotRows() {
      const rows = await sql`select payload from tissue_events where kind = 'policy_snapshot' order by id`;
      return rows.map((row) => row.payload as PolicySnapshotEntry);
    },
    async readLastPolicySnapshotRow() {
      const rows = await sql`select payload from tissue_events
        where kind = 'policy_snapshot' order by id desc limit 1`;
      return rows[0]?.payload as PolicySnapshotEntry | undefined;
    },

    async appendAnchorEvidenceRow(evidence) {
      await sql`insert into tissue_events (kind, fixture_id, payload)
        values ('anchor_evidence', ${evidence.fixtureId}, ${toJson(evidence)}::jsonb)`;
    },
    async readAllAnchorEvidenceRows() {
      const rows = await sql`select payload from tissue_events where kind = 'anchor_evidence' order by id`;
      return rows.map((row) => row.payload as AnchorEvidence);
    },

    async appendPreMatchCommitmentRow(evidence) {
      await sql`insert into tissue_events (kind, fixture_id, payload)
        values ('pre_match_commitment', ${evidence.fixtureId}, ${toJson(evidence)}::jsonb)`;
    },
    async readAllPreMatchCommitmentRows() {
      const rows = await sql`select payload from tissue_events where kind = 'pre_match_commitment' order by id`;
      return rows.map((row) => row.payload as PreMatchCommitmentEvidence);
    },

    async appendCheckpointRow(evidence) {
      await sql`insert into tissue_events (kind, fixture_id, payload)
        values ('checkpoint_anchor', ${evidence.fixtureId}, ${toJson(evidence)}::jsonb)`;
    },
    async readAllCheckpointRows() {
      const rows = await sql`select payload from tissue_events where kind = 'checkpoint_anchor' order by id`;
      return rows.map((row) => row.payload as CheckpointAnchorEvidence);
    },

    async appendVenueExecutionRow(evidence) {
      await sql`insert into tissue_events (kind, fixture_id, payload)
        values ('venue_execution', ${evidence.fixtureId}, ${toJson(evidence)}::jsonb)`;
    },
    async readAllVenueExecutionRows() {
      const rows = await sql`select payload from tissue_events where kind = 'venue_execution' order by id`;
      return rows.map((row) => row.payload as VenueExecutionEvidence);
    },

    async close() {
      await sql.end();
    },
  };
}
