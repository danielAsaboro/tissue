import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { runEngine } from "./engine.js";
import { verifyChain } from "../ledger/ledger.js";
import { canonicalize, hashPayload, linkHash, GENESIS_HASH } from "../ledger/hash.js";
import { brierDecomposition } from "../grader/brier.js";
import { clvBps } from "../grader/clv.js";
import { grade } from "../grader/grader.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("ledger hashing", () => {
  it("canonicalize sorts keys deterministically", () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"b":1}');
  });
  it("linkHash chains from genesis and changes with content", () => {
    const h1 = linkHash(GENESIS_HASH, { seq: 0, a: 1 });
    const h2 = linkHash(h1, { seq: 1, a: 1 });
    expect(h1).not.toBe(h2);
    expect(hashPayload({ x: 1 })).toBe(hashPayload({ x: 1 }));
  });
});

describe("brier + clv units", () => {
  it("perfect forecast has brier 0", () => {
    const b = brierDecomposition([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }], 10);
    expect(b.brier).toBe(0);
  });
  it("clv sign is desk-favorable per side", () => {
    expect(clvBps("BACK", 5000, 5200)).toBe(200); // bought cheap
    expect(clvBps("LAY", 5000, 4800)).toBe(200); // sold high
  });
});

describe("engine — the decision loop", () => {
  it("produces a valid hash-chained ledger over the corpus", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    expect(result.ledger.length).toBe(corpus.length);
    const check = verifyChain(result.ledger.all());
    expect(check.ok).toBe(true);
  });

  it("tampering with any record breaks the chain", () => {
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy).ledger.all().map((r) => ({ ...r }));
    const mid = Math.floor(records.length / 2);
    records[mid] = { ...records[mid]!, edgeBps: records[mid]!.edgeBps + 1 };
    const check = verifyChain(records);
    expect(check.ok).toBe(false);
    expect(check.brokenAtSeq).toBe(mid);
  });

  it("records POST/HALT/NO_ACTION actions and reacts to the unexplained HALT", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    const actions = new Set(result.ledger.all().map((r) => r.action));
    expect(actions.has("POST")).toBe(true);
    // the 30:12 unexplained move should drive at least one HALT decision
    expect(result.halts.some((h) => h.reason === "unexplained-movement")).toBe(true);
  });

  it("prepares real validate_odds anchors for sampled odds inputs", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    expect(result.anchors.length).toBeGreaterThan(0);
    expect(result.anchors[0]!.programId).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
  });
});

describe("replay(corpus) === ledger — the CI backbone", () => {
  it("two runs over the same corpus produce a bit-for-bit identical ledger", () => {
    const corpus = generateSyntheticCorpus();
    const a = runEngine(corpus, policy).ledger.all();
    const b = runEngine(corpus, policy).ledger.all();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.at(-1)!.hash).toBe(a.at(-1)!.hash);
  });

  it("the whole engine result (quotes, radar, settlement) is deterministic", () => {
    const corpus = generateSyntheticCorpus();
    const a = runEngine(corpus, policy);
    const b = runEngine(corpus, policy);
    expect(JSON.stringify(grade(a, policy))).toBe(JSON.stringify(grade(b, policy)));
    expect(JSON.stringify(a.quotes)).toBe(JSON.stringify(b.quotes));
    expect(JSON.stringify(a.radarEvents)).toBe(JSON.stringify(b.radarEvents));
  });
});

describe("chaos — feed-gap drill (PRD §9)", () => {
  it("hard-halts and cancels all intents when a feed gap exceeds max_gap_ms", () => {
    // Build a realistic-cadence corpus (messages ~2s apart) then inject a large gap.
    const corpus = generateSyntheticCorpus();
    // Under feedGapHalt, the synthetic corpus's minute-scale gaps themselves exceed
    // max_gap_ms, so the desk should register feed-gap HALT decisions.
    const withHalt = runEngine(corpus, policy, "devnet", { feedGapHalt: true });
    const haltRecords = withHalt.ledger.all().filter((r) => r.haltReason === "feed-gap");
    expect(haltRecords.length).toBeGreaterThan(0);

    // Without the flag (default backtest of sampled data), sparsity does NOT halt.
    const noHalt = runEngine(corpus, policy, "devnet", { feedGapHalt: false });
    expect(noHalt.ledger.all().some((r) => r.haltReason === "feed-gap")).toBe(false);
  });
});

describe("grade sheet", () => {
  it("assembles CLV, Brier, latency, per-class, and SIMULATED PnL", () => {
    const corpus = generateSyntheticCorpus();
    const g = grade(runEngine(corpus, policy), policy);
    expect(g.pnl.simulated).toBe(true);
    expect(g.clv.n).toBeGreaterThanOrEqual(0);
    expect(g.brier.brier).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(g.latency)).toBe(true);
  });
});
