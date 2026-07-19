import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { FeedMessage } from "@tissue/shared";
import type { RadarClass } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import { CORPUS_DIR, readCorpusFile } from "../ingest/corpus.js";
import { grade } from "../grader/grader.js";
import { runEngine } from "../replay/engine.js";
import { createPostgresLiveStore } from "../storage/liveStore.js";

/**
 * Cross-match backtest: every real corpus this repo has ever captured — the archived World Cup
 * fixtures (corpus/worldcup-2026/*.jsonl, local-only) and any live fixtures now durable in
 * Supabase — run through the SAME deterministic engine + grader as a single live message, then
 * rolled up into one report. Answers "what's Tissue's win rate" honestly: win rate here means
 * the fraction of priced quotes that beat the closing line (clv.pctPositive), pooled across
 * every fixture, not an average of averages.
 *
 * Real-corpora-only, same discipline as evaluateReal.ts: no synthetic (SYN-*) fixtures.
 * Simulated PnL (unmatched fixtures, no live venue) is kept strictly separate from real
 * settled PnL — never blended into one misleading number.
 */

export interface FixtureRow {
  readonly fixtureId: string;
  readonly source: "archive" | "live";
  readonly messages: number;
  readonly quotes: number;
  readonly clvN: number;
  readonly meanClvBps: number;
  readonly pctPositive: number;
  readonly brier: number;
  readonly perClass: readonly { readonly signalClass: RadarClass; readonly n: number; readonly hitRate: number; readonly meanClvBps: number }[];
  readonly realizedUnits: number;
  readonly matchedIntents: number;
  readonly pnlSimulated: boolean;
  readonly hashChainHead: string;
}

function isRealFixtureId(fixtureId: string): boolean {
  return !fixtureId.startsWith("SYN-");
}

function loadArchiveCorpora(archiveDir: string): { readonly fixtureId: string; readonly messages: readonly FeedMessage[] }[] {
  let entries;
  try {
    entries = readdirSync(archiveDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => basename(entry.name, ".jsonl"))
    .filter(isRealFixtureId)
    .map((fixtureId) => ({ fixtureId, messages: readCorpusFile(join(archiveDir, `${fixtureId}.jsonl`)) }))
    .filter(({ messages }) => messages.length > 0);
}

function evaluateFixture(fixtureId: string, source: FixtureRow["source"], messages: readonly FeedMessage[], policy: Policy): FixtureRow {
  const result = runEngine(messages, policy, messages[0]?.network ?? "devnet", { simulateFills: false });
  const sheet = grade(result, policy);
  return {
    fixtureId,
    source,
    messages: messages.length,
    quotes: result.quotes.length,
    clvN: sheet.clv.n,
    meanClvBps: sheet.clv.meanClvBps,
    pctPositive: sheet.clv.pctPositive,
    brier: sheet.brier.brier,
    perClass: sheet.perClass,
    realizedUnits: sheet.pnl.realizedUnits,
    matchedIntents: sheet.pnl.matchedIntents,
    pnlSimulated: sheet.pnl.simulated,
    hashChainHead: result.ledger.headHash,
  };
}

interface PerClassAggregate {
  readonly signalClass: RadarClass;
  readonly n: number;
  readonly weightedHitRate: number;
  readonly weightedMeanClvBps: number;
}

function aggregatePerClass(rows: readonly FixtureRow[]): PerClassAggregate[] {
  const byClass = new Map<RadarClass, { n: number; hitRateSum: number; clvSum: number }>();
  for (const row of rows) {
    for (const entry of row.perClass) {
      const bucket = byClass.get(entry.signalClass) ?? { n: 0, hitRateSum: 0, clvSum: 0 };
      bucket.n += entry.n;
      bucket.hitRateSum += entry.hitRate * entry.n;
      bucket.clvSum += entry.meanClvBps * entry.n;
      byClass.set(entry.signalClass, bucket);
    }
  }
  return [...byClass.entries()]
    .map(([signalClass, bucket]) => ({
      signalClass,
      n: bucket.n,
      weightedHitRate: bucket.n === 0 ? 0 : bucket.hitRateSum / bucket.n,
      weightedMeanClvBps: bucket.n === 0 ? 0 : Math.round(bucket.clvSum / bucket.n),
    }))
    .sort((a, b) => b.n - a.n);
}

export function aggregateFixtures(rows: readonly FixtureRow[]) {
  const clvN = rows.reduce((sum, row) => sum + row.clvN, 0);
  const weighted = (pick: (row: FixtureRow) => number): number =>
    clvN === 0 ? 0 : rows.reduce((sum, row) => sum + pick(row) * row.clvN, 0) / clvN;

  const realRows = rows.filter((row) => !row.pnlSimulated);
  const simulatedRows = rows.filter((row) => row.pnlSimulated);

  return {
    fixtures: rows.length,
    messages: rows.reduce((sum, row) => sum + row.messages, 0),
    quotes: rows.reduce((sum, row) => sum + row.quotes, 0),
    clvN,
    weightedMeanClvBps: Math.round(weighted((row) => row.meanClvBps)),
    winRate: clvN === 0 ? null : weighted((row) => row.pctPositive),
    weightedMeanBrier: clvN === 0 ? null : weighted((row) => row.brier),
    perClass: aggregatePerClass(rows),
    pnl: {
      realizedUnitsReal: realRows.reduce((sum, row) => sum + row.realizedUnits, 0),
      matchedIntentsReal: realRows.reduce((sum, row) => sum + row.matchedIntents, 0),
      fixturesWithRealFills: realRows.filter((row) => row.matchedIntents > 0).length,
      realizedUnitsSimulated: simulatedRows.reduce((sum, row) => sum + row.realizedUnits, 0),
      matchedIntentsSimulated: simulatedRows.reduce((sum, row) => sum + row.matchedIntents, 0),
    },
  };
}

async function main(): Promise<void> {
  const archiveDir = process.env.TISSUE_WORLDCUP_ARCHIVE_DIR ?? join(CORPUS_DIR, "worldcup-2026");
  const policy = loadPolicy();

  const archiveCorpora = loadArchiveCorpora(archiveDir);
  const rows: FixtureRow[] = archiveCorpora.map(({ fixtureId, messages }) => evaluateFixture(fixtureId, "archive", messages, policy));

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const store = createPostgresLiveStore(databaseUrl);
    try {
      const liveFixtureIds = (await store.listFixtureIds()).filter(isRealFixtureId);
      for (const fixtureId of liveFixtureIds) {
        const messages = await store.readLiveTape(fixtureId);
        if (messages.length === 0) continue;
        rows.push(evaluateFixture(fixtureId, "live", messages, policy));
      }
    } finally {
      await store.close();
    }
  } else {
    console.error(JSON.stringify({ event: "evaluate_all_fixtures.no_database_url", detail: "skipping live (Postgres) fixtures" }));
  }

  if (rows.length === 0) {
    throw new Error(
      `No real corpora found — checked ${archiveDir}${databaseUrl ? " and Supabase" : ""}. Run pnpm capture:worldcup or set DATABASE_URL.`,
    );
  }

  const aggregate = aggregateFixtures(rows);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "real-corpora-only (archive + live Postgres, never synthetic)",
    fixtures: rows,
    aggregate,
    ...(aggregate.clvN < 50
      ? { warning: `underpowered: only ${aggregate.clvN} priced quotes across ${rows.length} fixture(s) — treat winRate as directional, not conclusive` }
      : {}),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
