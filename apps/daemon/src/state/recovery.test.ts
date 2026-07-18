import { describe, expect, it, beforeAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";
import { loadPolicy, type Policy } from "../config/policy.js";
import { deriveKilled, resume, snapshotFromLedger } from "./recovery.js";
import { runEngine } from "../replay/engine.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import type { DecisionRecord } from "@tissue/shared";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

function record(seq: number, haltReason?: string): DecisionRecord {
  return {
    seq,
    triggerMsgId: `m${seq}`,
    triggerHash: "h",
    triggerNetwork: "devnet",
    ts: (1000 + seq) as never,
    action: haltReason ? "HALT" : "NO_ACTION",
    ...(haltReason ? { haltReason } : {}),
    policyHash: "p".repeat(64),
    state: { minute: 0, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, inventory: { bySelection: {}, netUnits: 0 }, exposure: { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 }, feedGapMs: 0, matchPhase: "regulation", stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral" },
    tissueProb: 5000 as never,
    marketProb: 5000 as never,
    edgeBps: 0,
    intents: [],
    simulated: true,
    prevHash: "0".repeat(64),
    hash: `hash${seq}`,
  };
}

describe("V3 — crash recovery", () => {
  it("derives the drawdown-kill latch from the persisted ledger", () => {
    expect(deriveKilled([record(0), record(1)])).toBe(false);
    expect(deriveKilled([record(0), record(1, "drawdown-kill"), record(2)])).toBe(true);
    // A feed-gap halt is NOT latched (auto-resumes) — only drawdown-kill latches.
    expect(deriveKilled([record(0, "feed-gap")])).toBe(false);
  });

  it("a killed desk stays halted on resume — never auto-resumes, never POSTs", () => {
    const corpus = generateSyntheticCorpus();
    const killedRun = runEngine(corpus, policy, "devnet", { initialKilled: true });
    const actions = new Set(killedRun.ledger.all().map((r) => r.action));
    expect(actions.has("POST")).toBe(false); // no new intents while killed
    expect(killedRun.book.allFills().length).toBe(0); // and therefore no fills/trades
  });

  it("resume rebuilds exact state deterministically (head hash matches a fresh run)", () => {
    const corpus = generateSyntheticCorpus();
    const fresh = runEngine(corpus, policy);
    const resumed = resume(corpus, policy);
    expect(resumed.result.ledger.headHash).toBe(fresh.ledger.headHash);
    expect(resumed.killed).toBe(false);
    expect(resumed.ledgerIntact).toBe(true);
  });

  it("resume honors a persisted drawdown-kill ledger — desk comes back killed", () => {
    const dir = mkdtempSync(join(tmpdir(), "tissue-recovery-"));
    const ledgerPath = join(dir, "killed.ledger.jsonl");
    const records = [record(0), record(1, "drawdown-kill")];
    writeFileSync(ledgerPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const corpus = generateSyntheticCorpus();
    const resumed = resume(corpus, policy, ledgerPath);
    expect(resumed.killed).toBe(true);
    expect(resumed.result.book.allFills().length).toBe(0); // stays flat while killed
  });

  it("snapshotFromLedger captures head hash + latch", () => {
    const snap = snapshotFromLedger([record(0), record(1, "drawdown-kill")]);
    expect(snap.killed).toBe(true);
    expect(snap.ledgerLen).toBe(2);
    expect(snap.headHash).toBe("hash1");
  });
});
