import { fetchScoresSnapshot } from "../src/ingest/snapshots.js";
import { verifyScoreOnChain } from "../src/exec/scoreAnchorLive.js";
import { loadCredentials, loadLiveConfig } from "../src/runtime/config.js";

async function main(): Promise<void> {
  const fixtureId = process.argv[2];
  if (!fixtureId) {
    throw new Error("fixture ID required: pnpm --filter @tissue/daemon verify:score-source -- <fixtureId>");
  }
  const config = loadLiveConfig();
  const credentials = loadCredentials(config);
  const messages = await fetchScoresSnapshot(config.origin, credentials, fixtureId);
  const score = messages
    .filter((message) => message.kind === "score" && message.sourceSeq !== undefined)
    .sort((a, b) => b.ts - a.ts)[0];
  if (!score || score.kind !== "score") {
    throw new Error(`TxLINE returned no sequenced score snapshot for fixture ${fixtureId}`);
  }
  const evidence = await verifyScoreOnChain(score, {
    origin: config.origin,
    rpcUrl: config.rpcUrl,
    network: config.network,
    credentials,
  });
  console.log(JSON.stringify({ score, evidence }, null, 2));
  if (!evidence.result) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
