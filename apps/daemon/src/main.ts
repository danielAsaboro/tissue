import { loadPolicy } from "./config/policy.js";
import { readCorpus } from "./ingest/corpus.js";
import { generateSyntheticCorpus, SYNTHETIC_FIXTURE_ID } from "./ingest/synthetic.js";
import { writeCorpus } from "./ingest/corpus.js";
import { runEngine } from "./replay/engine.js";
import { grade } from "./grader/grader.js";
import { verifyChain } from "./ledger/ledger.js";
import type { FeedMessage } from "@tissue/shared";

/**
 * Daemon entry point. Two modes:
 *   - REPLAY (default, offline): run the deterministic engine over a corpus and report.
 *   - LIVE: requires TISSUE_KEYPAIR_PATH + activated subscription; wires the dual SSE
 *     clients (src/ingest/sseClient.ts) into the SAME engine loop. Live wiring is gated on
 *     credentials + an activated X-Api-Token (see GROUND-TRUTH.md auth chain); until those
 *     exist the daemon runs the replay path so it is always demonstrable.
 *
 * The unattended-operation guarantee (PRD [AO]): all halts are automated inside the engine
 * (feed-gap, unexplained-movement, drawdown kill, model-divergence) — no human in the loop.
 */

async function main(): Promise<void> {
  const policy = loadPolicy();
  const fixtureId = process.env.TISSUE_SEED_FIXTURE_ID ?? SYNTHETIC_FIXTURE_ID;

  let corpus: FeedMessage[];
  try {
    corpus = readCorpus(fixtureId);
  } catch {
    corpus = generateSyntheticCorpus(fixtureId);
    writeCorpus(fixtureId, corpus);
  }

  const result = runEngine(corpus, policy);
  const chain = verifyChain(result.ledger.all());
  const g = grade(result, policy);

  console.log(
    JSON.stringify(
      {
        mode: "replay",
        fixtureId,
        messages: corpus.length,
        decisions: result.ledger.length,
        hashChainOk: chain.ok,
        headHash: result.ledger.headHash,
        radarEvents: result.radarEvents.length,
        halts: result.halts.map((h) => h.reason),
        anchorsPrepared: result.anchors.length,
        grade: {
          clv: g.clv,
          brier: { brier: g.brier.brier, reliability: g.brier.reliability, resolution: g.brier.resolution },
          pnlUnits: g.pnl.realizedUnits,
          pnlSimulated: g.pnl.simulated,
        },
        finalScore: result.finalScore,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
