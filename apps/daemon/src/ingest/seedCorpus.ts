import type { FeedMessage } from "@tissue/shared";
import { writeCorpus } from "./corpus.js";
import { generateSyntheticCorpus, SYNTHETIC_FIXTURE_ID } from "./synthetic.js";
import { fetchGuestJwt } from "./txlineAuth.js";
import { fetchOddsSnapshot, fetchScoresSnapshot, orderByFeed } from "./snapshots.js";

/**
 * Corpus seeder (Phase 1.3). ALWAYS writes the deterministic synthetic corpus (tests and
 * replay-equality CI depend on it existing and being byte-stable). ADDITIONALLY, if a
 * fixture id + reachable devnet origin are given, attempts a live snapshot seed from a
 * COMPLETED World Cup fixture — best-effort, non-fatal on failure.
 *
 * Completed QF fixture ids (from the sponsor schedule, GROUND-TRUTH.md §3b):
 *   18209181 FRA 2-0 MAR · 18218149 ESP 2-1 BEL · 18213979 NOR 1-2 ENG · 18222446 ARG 3-1 SUI
 *
 * NOTE: the snapshot endpoints require an activated X-Api-Token (guest JWT alone is
 * insufficient for data). Without on-chain subscribe + activate this will 401 — expected;
 * the synthetic corpus is the guaranteed path until credentials/live capture are wired.
 */

const DEVNET_ORIGIN = process.env.TXLINE_DEVNET_ORIGIN ?? "https://txline-dev.txodds.com";

async function trySeedLive(fixtureId: string): Promise<boolean> {
  try {
    const jwt = await fetchGuestJwt(DEVNET_ORIGIN);
    const creds = { network: "devnet" as const, jwt, apiToken: "" };
    const [scores, odds] = await Promise.all([
      fetchScoresSnapshot(DEVNET_ORIGIN, creds, fixtureId),
      fetchOddsSnapshot(DEVNET_ORIGIN, creds, fixtureId),
    ]);
    const merged: FeedMessage[] = orderByFeed([...scores, ...odds]);
    if (merged.length === 0) {
      console.error(`[seed] live snapshot empty for ${fixtureId} (likely needs X-Api-Token)`);
      return false;
    }
    const path = writeCorpus(fixtureId, merged);
    console.error(`[seed] live corpus written: ${path} (${merged.length} msgs)`);
    return true;
  } catch (err) {
    console.error(`[seed] live seed failed (expected without activation): ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const synthetic = generateSyntheticCorpus();
  const synthPath = writeCorpus(SYNTHETIC_FIXTURE_ID, synthetic);
  console.error(`[seed] synthetic corpus written: ${synthPath} (${synthetic.length} msgs)`);

  const fixtureId = process.env.TISSUE_SEED_FIXTURE_ID ?? process.argv[2];
  if (fixtureId) await trySeedLive(fixtureId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
