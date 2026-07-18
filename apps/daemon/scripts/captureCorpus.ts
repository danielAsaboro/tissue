import { fetchOddsSnapshot, fetchScoresSnapshot, orderByFeed } from "../src/ingest/snapshots.js";
import { writeCorpus } from "../src/ingest/corpus.js";
import { loadCredentials, loadLiveConfig } from "../src/runtime/config.js";

/**
 * Real-corpus capture from an ALREADY-ACTIVATED TxLINE session (any network). Unlike
 * liveActivate.ts, this does not run the on-chain subscribe/activate flow; it reuses the same
 * loadLiveConfig/loadCredentials boundary the daemon itself uses, so a clean-checkout run either
 * succeeds against a real, activated session or fails loudly the same way the daemon would.
 *
 * Usage: TISSUE_MODE=live TISSUE_NETWORK=mainnet TXLINE_JWT=… TXLINE_API_TOKEN=… \
 *   pnpm --filter @tissue/daemon capture:corpus -- <fixtureId>
 */

async function main(): Promise<void> {
  const fixtureId = process.argv[2];
  if (!fixtureId) {
    throw new Error("fixture ID required: pnpm --filter @tissue/daemon capture:corpus -- <fixtureId>");
  }
  const config = loadLiveConfig();
  const creds = loadCredentials(config);
  console.log(`[capture] network=${config.network} origin=${config.origin} fixture=${fixtureId}`);

  const scores = await fetchScoresSnapshot(config.origin, creds, fixtureId);
  const inPlayTs = scores
    .filter((s) => s.kind === "score" && s.minute > 0)
    .map((s) => s.ts)
    .sort((a, b) => a - b);

  // Bare odds snapshots return 0 rows once the market has closed post-match — sample `asOf`
  // across the in-play window to reconstruct a real odds series (feedback.md F-002).
  const odds: Awaited<ReturnType<typeof fetchOddsSnapshot>> = [];
  if (inPlayTs.length >= 2) {
    const lo = inPlayTs[0]!;
    const hi = inPlayTs[inPlayTs.length - 1]!;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const asOf = Math.round(lo + ((hi - lo) * i) / (N - 1));
      const batch = await fetchOddsSnapshot(config.origin, creds, fixtureId, asOf);
      odds.push(...batch);
    }
  }

  console.log(`[capture] scores=${scores.length} odds=${odds.length}`);
  if (scores.length === 0 || odds.length === 0) {
    throw new Error(
      `real capture incomplete for ${fixtureId}: scores=${scores.length}, odds=${odds.length}; choose a fixture with an accessible in-play window`,
    );
  }

  const merged = orderByFeed([...scores, ...odds]);
  const path = writeCorpus(fixtureId, merged);
  console.log(`[capture] REAL corpus written: ${path} (${merged.length} msgs)`);
}

main().catch((error: unknown) => {
  console.error(`[capture] FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
