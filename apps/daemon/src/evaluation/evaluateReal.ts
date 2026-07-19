import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { FeedMessage } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import { CORPUS_DIR, readCorpusFile } from "../ingest/corpus.js";
import { grade } from "../grader/grader.js";
import { runEngine } from "../replay/engine.js";

export interface EvaluationRow {
  readonly fixtureId: string;
  readonly messages: number;
  readonly decisions: number;
  readonly quotes: number;
  readonly clvN: number;
  readonly meanClvBps: number;
  readonly brier: number;
  readonly marketBaselineBrier: number | null;
  readonly withoutPressureMeanClvBps: number;
  readonly hashChainHead: string;
}

export function isRealCorpus(path: string, messages: readonly FeedMessage[]): boolean {
  const fixtureId = basename(path, ".jsonl");
  return (
    !fixtureId.startsWith("SYN-") &&
    !fixtureId.endsWith(".ledger") &&
    messages.length > 0 &&
    messages.every((message) => message.fixtureId === fixtureId && (message.network === "devnet" || message.network === "mainnet"))
  );
}

/** Every real (non-synthetic) corpus currently checked out in CORPUS_DIR. */
export function loadRealCorpora(): { readonly fixtureId: string; readonly messages: readonly FeedMessage[] }[] {
  const paths = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.endsWith(".ledger.jsonl"))
    .map((entry) => join(CORPUS_DIR, entry.name));
  return paths
    .map((path) => ({ fixtureId: basename(path, ".jsonl"), messages: readCorpusFile(path) }))
    .filter(({ fixtureId, messages }) => isRealCorpus(join(CORPUS_DIR, `${fixtureId}.jsonl`), messages));
}

function noPressure(policy: Policy): Policy {
  const cloned = structuredClone(policy);
  return {
    ...cloned,
    model: {
      ...cloned.model,
      pressure: { ...cloned.model.pressure, enabled: false },
    },
  };
}

function marketBaselineBrier(messages: readonly FeedMessage[]): number | null {
  const opening = messages.find(
    (message) => message.kind === "odds" && message.marketKey.market === "1X2",
  );
  const final = [...messages].reverse().find((message) => message.kind === "score" && message.isFinal);
  if (!opening || opening.kind !== "odds" || !final || final.kind !== "score") return null;
  const p = (opening.consensus.HOME ?? 0) / 10_000;
  const outcome = final.homeScore > final.awayScore ? 1 : 0;
  return (p - outcome) ** 2;
}

export function evaluateCorpus(messages: readonly FeedMessage[], policy: Policy): EvaluationRow {
  const result = runEngine(messages, policy, messages[0]?.network ?? "devnet", { simulateFills: false });
  const sheet = grade(result, policy);
  const withoutPressure = runEngine(messages, noPressure(policy), messages[0]?.network ?? "devnet", {
    simulateFills: false,
  });
  const withoutPressureSheet = grade(withoutPressure, noPressure(policy));
  return {
    fixtureId: result.fixtureId,
    messages: messages.length,
    decisions: result.ledger.length,
    quotes: result.quotes.length,
    clvN: sheet.clv.n,
    meanClvBps: sheet.clv.meanClvBps,
    brier: sheet.brier.brier,
    marketBaselineBrier: marketBaselineBrier(messages),
    withoutPressureMeanClvBps: withoutPressureSheet.clv.meanClvBps,
    hashChainHead: result.ledger.headHash,
  };
}

function main(): void {
  const corpora = loadRealCorpora();
  if (corpora.length === 0) {
    throw new Error(
      `No real TxLINE corpora found in ${CORPUS_DIR}. Run the live daemon or live activation capture; synthetic data is never accepted by this evaluator.`,
    );
  }
  const policy = loadPolicy();
  const fixtures = corpora.map(({ messages }) => evaluateCorpus(messages, policy));
  const clvN = fixtures.reduce((sum, fixture) => sum + fixture.clvN, 0);
  const weightedClv = clvN === 0
    ? 0
    : Math.round(fixtures.reduce((sum, fixture) => sum + fixture.meanClvBps * fixture.clvN, 0) / clvN);
  const comparable = fixtures.filter((fixture) => fixture.marketBaselineBrier !== null);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "real-txline-corpora-only",
    fixtures,
    aggregate: {
      fixtures: fixtures.length,
      messages: fixtures.reduce((sum, fixture) => sum + fixture.messages, 0),
      quotes: fixtures.reduce((sum, fixture) => sum + fixture.quotes, 0),
      clvN,
      weightedMeanClvBps: weightedClv,
      meanTissueBrier: comparable.length
        ? comparable.reduce((sum, fixture) => sum + fixture.brier, 0) / comparable.length
        : null,
      meanMarketBaselineBrier: comparable.length
        ? comparable.reduce((sum, fixture) => sum + fixture.marketBaselineBrier!, 0) / comparable.length
        : null,
    },
  }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
