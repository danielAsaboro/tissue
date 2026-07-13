import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { loadPolicy } from "../config/policy.js";
import { readCorpus, CORPUS_DIR } from "../ingest/corpus.js";
import { generateSyntheticCorpus, SYNTHETIC_FIXTURE_ID } from "../ingest/synthetic.js";
import { writeCorpus } from "../ingest/corpus.js";
import { runEngine } from "./engine.js";
import { grade } from "../grader/grader.js";
import { verifyChain } from "../ledger/ledger.js";
import type { FeedMessage } from "@tissue/shared";

/**
 * Replay lab (PRD §9). Reruns a corpus through the SAME engine the live daemon uses — so it
 * doubles as backtester and demo generator. Confirms determinism (two runs → identical head
 * hash + verifyChain) and writes the ledger JSONL for the dashboard/flight recorder.
 *
 * Usage: pnpm replay [fixtureId] [--speed=N]
 *   speed is a demo throttle (x realtime); default 0 = instant. Determinism is unaffected.
 */

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p?.split("=")[1];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const policy = loadPolicy();
  const fixtureId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : SYNTHETIC_FIXTURE_ID;
  const speed = Number(arg("speed") ?? "0");

  let corpus: FeedMessage[];
  try {
    corpus = readCorpus(fixtureId);
  } catch {
    corpus = generateSyntheticCorpus(fixtureId);
    writeCorpus(fixtureId, corpus);
  }

  console.log(`\n▏TISSUE replay · fixture ${fixtureId} · ${corpus.length} messages · devnet · SIMULATED book\n`);

  // Optional demo throttle: narrate the tape at N× realtime.
  if (speed > 0) {
    let prevTs: number | null = null;
    for (const m of corpus) {
      if (prevTs != null) await sleep(Math.min(1500, (m.ts - prevTs) / speed));
      prevTs = m.ts;
      if (m.kind === "score") {
        console.log(`  ${pad(m.minute)}'  score ${m.homeScore}-${m.awayScore}${m.homeReds || m.awayReds ? `  reds ${m.homeReds}/${m.awayReds}` : ""}${m.isFinal ? "  FT" : ""}`);
      }
    }
  }

  const result = runEngine(corpus, policy);
  const g = grade(result, policy);
  const chain = verifyChain(result.ledger.all());

  // Determinism confirmation against Phase 7's CI assertion.
  const rerun = runEngine(corpus, policy);
  const deterministic = rerun.ledger.headHash === result.ledger.headHash;

  const ledgerPath = join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`);
  result.ledger.writeJsonl(ledgerPath);

  // Analyst export — a benign read-model projection of already-hash-chained data. The
  // read-only analyst layer (apps/analyst) materializes this; it never produces it.
  const analystExport = {
    fixtureId,
    generatedAtMsgId: g.generatedAtMsgId,
    decisions: result.ledger.all(),
    radarEvents: result.radarEvents,
    grade: g,
    finalScore: result.finalScore,
  };
  const exportPath = join(CORPUS_DIR, `${fixtureId}.analyst.json`);
  writeFileSync(exportPath, JSON.stringify(analystExport), "utf8");

  console.log("── flight recorder ─────────────────────────────");
  console.log(`  decisions      ${result.ledger.length}`);
  console.log(`  hash chain     ${chain.ok ? "OK" : `BROKEN @ seq ${chain.brokenAtSeq}`}`);
  console.log(`  determinism    ${deterministic ? "OK (identical head hash on rerun)" : "FAILED"}`);
  console.log(`  head hash      ${result.ledger.headHash.slice(0, 16)}…`);
  console.log(`  ledger written ${ledgerPath}`);
  console.log("── radar ───────────────────────────────────────");
  console.log(`  events         ${result.radarEvents.length}  (${summarizeClasses(result.radarEvents)})`);
  console.log(`  halts          ${result.halts.length}  (${result.halts.map((h) => h.reason).join(", ") || "none"})`);
  console.log("── grade sheet ─────────────────────────────────");
  console.log(`  CLV            n=${g.clv.n}  mean ${g.clv.meanClvBps}bps  +ve ${(g.clv.pctPositive * 100).toFixed(0)}%`);
  console.log(`  Brier          ${g.brier.brier.toFixed(4)}  (reliability ${g.brier.reliability.toFixed(4)}, resolution ${g.brier.resolution.toFixed(4)})`);
  console.log(`  latency        ${g.latency.map((l) => `${l.market} p50=${l.p50Ms}ms`).join("  ") || "none"}`);
  console.log(`  PnL            ${g.pnl.realizedUnits} units  ·  matched ${g.pnl.matchedIntents}  ·  SIMULATED`);
  console.log(`  anchors        ${result.anchors.length} validate_odds PDAs prepared (devnet)`);
  console.log(`  final score    ${result.finalScore.home}-${result.finalScore.away}\n`);
}

function pad(n: number): string {
  return String(n).padStart(2, " ");
}

function summarizeClasses(events: readonly { signalClass: string }[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.signalClass, (counts.get(e.signalClass) ?? 0) + 1);
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(", ") || "none";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
