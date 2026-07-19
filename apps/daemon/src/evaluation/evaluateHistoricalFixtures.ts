import type { FeedMessage } from "@tissue/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadPolicy } from "../config/policy.js";
import {
  ARCHIVE_REPLAY_TOKEN,
  historicalFixtureRoot,
  listenHistoricalFixtureServer,
  loadHistoricalFixtureIndex,
} from "../ingest/historicalFixtureService.js";
import { orderByFeed, fetchOddsSnapshot, fetchScoresHistorical } from "../ingest/snapshots.js";
import type { AuthCredentials } from "../ingest/txlineAuth.js";
import { evaluateCorpus } from "./evaluateReal.js";
import { splitFixtures } from "./calibrationSplit.js";

function uniqueMessages(messages: readonly FeedMessage[]): FeedMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.kind}:${message.msgId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadHistoricalCorpusThroughService(
  origin: string,
  creds: AuthCredentials,
  fixtureId: string,
  kickoff: number,
): Promise<FeedMessage[]> {
  const scores = await fetchScoresHistorical(origin, creds, fixtureId);
  const sampleTimes = [kickoff - 5 * 60_000, kickoff + 45 * 60_000, kickoff + 90 * 60_000, kickoff + 150 * 60_000];
  const odds = (await Promise.all(sampleTimes.map((asOf) => fetchOddsSnapshot(origin, creds, fixtureId, asOf)))).flat();
  const messages = orderByFeed(uniqueMessages([...scores, ...odds]));
  if (!messages.some((message) => message.kind === "score" && message.isFinal)) {
    throw new Error(`fixture ${fixtureId} has no normalized terminal score`);
  }
  if (!messages.some((message) => message.kind === "odds" && message.marketKey.market === "1X2")) {
    throw new Error(`fixture ${fixtureId} has no normalized 1X2 odds`);
  }
  return messages;
}

function aggregate(rows: readonly ReturnType<typeof evaluateCorpus>[]): object {
  const clvN = rows.reduce((sum, row) => sum + row.clvN, 0);
  const comparable = rows.filter((row) => row.marketBaselineBrier !== null);
  return {
    fixtures: rows.length,
    messages: rows.reduce((sum, row) => sum + row.messages, 0),
    quotes: rows.reduce((sum, row) => sum + row.quotes, 0),
    clvN,
    weightedMeanClvBps: clvN === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.meanClvBps * row.clvN, 0) / clvN),
    meanTissueBrier: comparable.length === 0 ? null : comparable.reduce((sum, row) => sum + row.brier, 0) / comparable.length,
    meanMarketBaselineBrier: comparable.length === 0 ? null : comparable.reduce((sum, row) => sum + row.marketBaselineBrier!, 0) / comparable.length,
  };
}

async function main(): Promise<void> {
  const root = historicalFixtureRoot();
  const index = loadHistoricalFixtureIndex(root);
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const requested = args.filter((arg) => /^\d+$/.test(arg));
  const completed = index.fixtures.filter((row) => row.terminalSequence !== null);
  const selected = all
    ? completed
    : requested.length > 0
      ? requested.map((id) => {
          const row = index.fixtures.find((candidate) => String(candidate.fixtureId) === id);
          if (!row) throw new Error(`fixture ${id} is absent from ${root}`);
          return row;
        })
      : completed.filter((row) => row.fixtureId === index.focusFixtureId);
  if (selected.length === 0) throw new Error("no completed historical fixtures selected");

  const { server, origin } = await listenHistoricalFixtureServer(root);
  const creds: AuthCredentials = { network: "mainnet", jwt: ARCHIVE_REPLAY_TOKEN, apiToken: ARCHIVE_REPLAY_TOKEN };
  try {
    const policy = loadPolicy();
    const corpora = [] as { readonly fixtureId: string; readonly messages: readonly FeedMessage[] }[];
    for (const fixture of selected) {
      const fixtureId = String(fixture.fixtureId);
      corpora.push({ fixtureId, messages: await loadHistoricalCorpusThroughService(origin, creds, fixtureId, fixture.kickoff) });
    }
    const split = splitFixtures(corpora.map((corpus) => corpus.fixtureId), 0.3);
    const calibrationRows = corpora.filter((corpus) => split.calibration.includes(corpus.fixtureId)).map((corpus) => evaluateCorpus(corpus.messages, policy));
    const holdoutRows = corpora.filter((corpus) => split.holdout.includes(corpus.fixtureId)).map((corpus) => evaluateCorpus(corpus.messages, policy));
    const report = {
      generatedAt: new Date().toISOString(),
      source: "sha256-verified-authenticated-txline-archive-via-http-sse",
      archiveCapturedAt: index.capturedAt,
      fixtureRoot: root,
      selectedFixtureIds: corpora.map((corpus) => corpus.fixtureId),
      split: { holdoutFraction: 0.3, calibration: split.calibration, holdout: split.holdout },
      calibration: { fixtures: calibrationRows, aggregate: aggregate(calibrationRows) },
      holdout: { fixtures: holdoutRows, aggregate: aggregate(holdoutRows) },
    };
    const rendered = JSON.stringify(report, null, 2) + "\n";
    const outputPath = process.env.TISSUE_EVALUATION_REPORT;
    if (outputPath) {
      const absolute = resolve(outputPath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, rendered, "utf8");
      console.log(JSON.stringify({
        report: absolute,
        selectedFixtures: corpora.length,
        calibration: report.calibration.aggregate,
        holdout: report.holdout.aggregate,
      }, null, 2));
    } else {
      console.log(rendered.trimEnd());
    }
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
