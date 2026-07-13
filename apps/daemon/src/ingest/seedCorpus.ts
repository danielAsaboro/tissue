import { writeCorpus } from "./corpus.js";
import { generateSyntheticCorpus, SYNTHETIC_FIXTURE_ID } from "./synthetic.js";

/**
 * Explicit deterministic replay fixture writer. This is test/research input only and is
 * never called by the live daemon. Real capture is owned by the live service, which requires
 * activated credentials and fails closed when they are absent.
 */

async function main(): Promise<void> {
  const synthetic = generateSyntheticCorpus();
  const synthPath = writeCorpus(SYNTHETIC_FIXTURE_ID, synthetic);
  console.error(`[replay-fixture] synthetic corpus written: ${synthPath} (${synthetic.length} msgs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
