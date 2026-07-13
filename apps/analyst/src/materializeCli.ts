import { materializeExports, readExportsDir } from "./materialize.js";
import { CORPUS_DIR, DB_PATH } from "./paths.js";

/**
 * Build the analyst read-model: `pnpm --filter @tissue/analyst materialize`.
 * Reads corpus/*.analyst.json (written by the replay/daemon) → corpus/analyst.db.
 */
const exports = readExportsDir(CORPUS_DIR);
if (exports.length === 0) {
  console.error(`[analyst] no *.analyst.json in ${CORPUS_DIR} — run \`pnpm replay\` first.`);
  process.exit(1);
}
materializeExports(DB_PATH, exports);
console.error(`[analyst] materialized ${exports.length} fixture export(s) → ${DB_PATH}`);
