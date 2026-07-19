import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionRecord, FeedMessage } from "@tissue/shared";
import { CORPUS_DIR } from "../src/ingest/corpus.js";
import { createPostgresLiveStore } from "../src/storage/liveStore.js";
import type { AnchorEvidence } from "../src/exec/anchorLive.js";
import type { PreMatchCommitmentEvidence } from "../src/exec/preMatchCommit.js";
import type { CheckpointAnchorEvidence } from "../src/exec/periodicAnchor.js";
import type { VenueExecutionEvidence } from "../src/exec/venue.js";
import type { PolicySnapshotEntry } from "../src/config/policySnapshot.js";

/**
 * One-time migration: the local CORPUS_DIR JSONL journals this repo already had (real live
 * captures made before Postgres persistence existed) -> Supabase. Run once against a fresh
 * schema (schema.sql) before the daemon starts writing to it live.
 *
 * Deliberately excludes:
 *  - corpus/worldcup-2026/* — the backtesting archive, intentionally local-only, never part of
 *    live-desk persistence.
 *  - SYN-*  fixtures — synthetic/test fixtures, not real captures (same filter apps/analyst
 *    already applies).
 *  - *.analyst.json, live-state.json — still file-based on purpose, not migrated.
 *
 * Usage: DATABASE_URL=... pnpm --filter @tissue/daemon exec tsx scripts/backfillSupabase.ts
 */

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const store = createPostgresLiveStore(databaseUrl);

  const fixtureIds = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.endsWith(".ledger.jsonl"))
    .map((entry) => entry.name.slice(0, -".jsonl".length))
    .filter((name) => !name.startsWith("SYN-"))
    .filter((name) => ![
      "policy-snapshots", "anchor-evidence", "pre-match-commitments",
      "checkpoint-anchors", "venue-executions", "slip-executions",
    ].includes(name));

  let messagesWritten = 0;
  let decisionsWritten = 0;
  for (const fixtureId of fixtureIds) {
    const messages = readJsonl<FeedMessage>(join(CORPUS_DIR, `${fixtureId}.jsonl`));
    for (const message of messages) {
      await store.appendLiveMessage(fixtureId, message);
      messagesWritten += 1;
    }
    const decisions = readJsonl<DecisionRecord>(join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`));
    for (const record of decisions) {
      await store.appendDecision(fixtureId, record);
      decisionsWritten += 1;
    }
    console.log(JSON.stringify({ event: "backfill.fixture", fixtureId, messages: messages.length, decisions: decisions.length }));
  }

  let anchorEvidenceWritten = 0;
  for (const evidence of readJsonl<AnchorEvidence>(join(CORPUS_DIR, "anchor-evidence.jsonl"))) {
    await store.appendAnchorEvidenceRow(evidence);
    anchorEvidenceWritten += 1;
  }

  let commitmentsWritten = 0;
  for (const evidence of readJsonl<PreMatchCommitmentEvidence>(join(CORPUS_DIR, "pre-match-commitments.jsonl"))) {
    await store.appendPreMatchCommitmentRow(evidence);
    commitmentsWritten += 1;
  }

  let checkpointsWritten = 0;
  for (const evidence of readJsonl<CheckpointAnchorEvidence>(join(CORPUS_DIR, "checkpoint-anchors.jsonl"))) {
    await store.appendCheckpointRow(evidence);
    checkpointsWritten += 1;
  }

  let venueExecutionsWritten = 0;
  for (const filename of ["slip-executions.jsonl", "venue-executions.jsonl"]) {
    for (const evidence of readJsonl<VenueExecutionEvidence>(join(CORPUS_DIR, filename))) {
      await store.appendVenueExecutionRow(evidence);
      venueExecutionsWritten += 1;
    }
  }

  let policySnapshotsWritten = 0;
  for (const entry of readJsonl<PolicySnapshotEntry>(join(CORPUS_DIR, "policy-snapshots.jsonl"))) {
    await store.appendPolicySnapshotRow(entry);
    policySnapshotsWritten += 1;
  }

  console.log(JSON.stringify({
    event: "backfill.complete",
    fixtures: fixtureIds.length,
    messagesWritten,
    decisionsWritten,
    anchorEvidenceWritten,
    commitmentsWritten,
    checkpointsWritten,
    venueExecutionsWritten,
    policySnapshotsWritten,
  }));
  await store.close();
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "backfill.failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
