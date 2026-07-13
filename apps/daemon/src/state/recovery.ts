import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DecisionRecord } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { runEngine, type EngineResult } from "../replay/engine.js";
import { readCorpus } from "../ingest/corpus.js";
import { readLedgerJsonl, verifyChain } from "../ledger/ledger.js";
import type { FeedMessage } from "@tissue/shared";

/**
 * Crash recovery (V3, PRD §5). The daemon's decision engine is PURE over (corpus, policy),
 * so the correct, minimal safe-restart is: replay the already-processed corpus to rebuild
 * exact in-flight state (open intents, inventory, exposure, base lambdas, pressure), then
 * resume live from the next message. The one thing replay alone must NOT lose is the
 * drawdown-kill LATCH — a killed desk must stay killed across a restart (operator-only).
 *
 * This module: derives the latch from the persisted ledger, persists a tiny operational
 * snapshot, and resumes engine state deterministically. It never writes the ledger and
 * never touches the decision modules — it only re-runs the pure engine.
 */

export interface RecoverySnapshot {
  readonly lastMsgId: string | null;
  readonly headHash: string;
  readonly ledgerLen: number;
  readonly killed: boolean;
}

/** The drawdown kill is latched: if the ledger ever recorded it, the desk stays killed. */
export function deriveKilled(records: readonly DecisionRecord[]): boolean {
  return records.some((r) => r.haltReason === "drawdown-kill");
}

export function snapshotFromLedger(records: readonly DecisionRecord[]): RecoverySnapshot {
  const last = records.at(-1);
  return {
    lastMsgId: last?.triggerMsgId ?? null,
    headHash: last?.hash ?? "0".repeat(64),
    ledgerLen: records.length,
    killed: deriveKilled(records),
  };
}

export function writeRecoverySnapshot(path: string, snap: RecoverySnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap), "utf8");
}

export function readRecoverySnapshot(path: string): RecoverySnapshot | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RecoverySnapshot;
}

export interface ResumeResult {
  readonly result: EngineResult;
  readonly killed: boolean;
  readonly ledgerIntact: boolean;
  readonly resumedFromLedger: boolean;
}

/**
 * Rebuild engine state by deterministically replaying the corpus so far, honoring the
 * drawdown-kill latch reconstructed from the persisted ledger (if any). The returned
 * EngineResult's head hash matches the original run — proving the rebuild is exact.
 */
export function resume(
  corpusSoFar: readonly FeedMessage[],
  policy: Policy,
  persistedLedgerPath?: string,
): ResumeResult {
  let killed = false;
  let ledgerIntact = true;
  let resumedFromLedger = false;

  if (persistedLedgerPath && existsSync(persistedLedgerPath)) {
    const records = readLedgerJsonl(persistedLedgerPath);
    ledgerIntact = verifyChain(records).ok;
    killed = deriveKilled(records);
    resumedFromLedger = true;
  }

  const result = runEngine(corpusSoFar, policy, "devnet", { initialKilled: killed });
  // Re-derive the latch from the rebuilt ledger too (belt and suspenders).
  killed = killed || deriveKilled(result.ledger.all());
  return { result, killed, ledgerIntact, resumedFromLedger };
}

/** Convenience: resume a fixture from its on-disk corpus + ledger. */
export function resumeFixture(fixtureId: string, policy: Policy, ledgerPath: string): ResumeResult {
  return resume(readCorpus(fixtureId), policy, ledgerPath);
}
