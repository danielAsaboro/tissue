import { mkdirSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AnalystExport } from "@tissue/shared";
import { CORPUS_DIR, readCorpusFile } from "../src/ingest/corpus.js";
import { loadPolicy } from "../src/config/policy.js";
import { runEngine } from "../src/replay/engine.js";
import { grade } from "../src/grader/grader.js";

/**
 * One-time: generate AnalystExport JSON (the same shape liveDesk.ts writes per-fixture on the
 * live path) for every real archived World Cup fixture, so the analyst service — which reads
 * these from its OWN container's local corpus dir, not from Postgres — has real data to serve
 * from without depending on the live daemon having freshly processed that exact fixture in its
 * own (separate, ephemeral) container.
 */
async function main(): Promise<void> {
  const archiveDir = process.env.TISSUE_WORLDCUP_ARCHIVE_DIR ?? join(CORPUS_DIR, "worldcup-2026");
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: tsx exportAnalyst.ts <outDir>");
  mkdirSync(outDir, { recursive: true });

  const policy = loadPolicy();
  const files = readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => basename(entry.name, ".jsonl"));

  let written = 0;
  for (const fixtureId of files) {
    const messages = readCorpusFile(join(archiveDir, `${fixtureId}.jsonl`));
    if (messages.length === 0) continue;
    const result = runEngine(messages, policy, messages[0]!.network);
    const sheet = grade(result, policy);
    const output: AnalystExport = {
      fixtureId,
      generatedAtMsgId: sheet.generatedAtMsgId,
      decisions: result.ledger.all(),
      radarEvents: result.radarEvents,
      grade: sheet,
      finalScore: result.finalScore,
    };
    writeFileSync(join(outDir, `${fixtureId}.analyst.json`), JSON.stringify(output));
    written += 1;
  }
  console.log(JSON.stringify({ event: "export_analyst.complete", written, outDir }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
