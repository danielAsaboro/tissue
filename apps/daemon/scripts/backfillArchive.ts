import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import postgres from "postgres";
import type { FeedMessage } from "@tissue/shared";
import { CORPUS_DIR, readCorpusFile } from "../src/ingest/corpus.js";

/**
 * One-time: push the local World Cup backtest archive (corpus/worldcup-2026/*.jsonl,
 * never uploaded anywhere — see evaluateAllFixtures.ts) into the SAME Supabase tissue_events
 * table the live daemon reads from, so the deployed /backtest endpoint can serve any of these
 * 100+ real fixtures, not just the 1-2 the live desk has actually processed itself.
 *
 * Bulk-loading tool only — bypasses the one-message-at-a-time LiveStore interface (correct for
 * the live daemon's real-time arrival, too slow for a one-shot archive load of ~15k messages)
 * in favor of a single multi-row INSERT per fixture.
 *
 * Usage: DATABASE_URL=... pnpm --filter @tissue/daemon exec tsx scripts/backfillArchive.ts
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const archiveDir = process.env.TISSUE_WORLDCUP_ARCHIVE_DIR ?? join(CORPUS_DIR, "worldcup-2026");

  const sql = postgres(databaseUrl, { ssl: "require", max: 10 });
  const existingRows = await sql`select distinct fixture_id from tissue_events where kind = 'corpus_message'`;
  const existing = new Set(existingRows.map((row) => row.fixture_id as string));

  const files = readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => basename(entry.name, ".jsonl"))
    .filter((fixtureId) => !existing.has(fixtureId));

  let fixturesWritten = 0;
  let messagesWritten = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (fixtureId) => {
      const messages: FeedMessage[] = readCorpusFile(join(archiveDir, `${fixtureId}.jsonl`));
      if (messages.length === 0) return;
      const rows: Record<string, unknown>[] = messages.map((message) => ({ kind: "corpus_message", fixture_id: fixtureId, payload: message }));
      await sql`insert into tissue_events ${sql(rows, "kind", "fixture_id", "payload")}`;
      fixturesWritten += 1;
      messagesWritten += messages.length;
      console.log(JSON.stringify({ event: "backfill_archive.fixture", fixtureId, messages: messages.length }));
    }));
  }

  console.log(JSON.stringify({ event: "backfill_archive.complete", fixturesWritten, messagesWritten, alreadyPresent: existing.size }));
  await sql.end();
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "backfill_archive.failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
