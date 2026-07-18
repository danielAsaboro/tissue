import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { verifyChain } from "../ledger/ledger.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { baselinePolicy } from "./baselinePolicy.js";
import { runArena, summarizeArena } from "./arena.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("baselinePolicy — every flagged heuristic neutralized to a no-op", () => {
  it("disables pressure and informed-flow", () => {
    const b = baselinePolicy(policy);
    expect(b.model.pressure.enabled).toBe(false);
    expect(b.radar.informed_flow.enabled).toBe(false);
  });

  it("neutralizes every spread/size multiplier to 1", () => {
    const b = baselinePolicy(policy);
    expect(b.strategy.stoppage_spread_mult).toBe(1);
    expect(b.strategy.mutual_danger_spread_mult).toBe(1);
    expect(b.strategy.mutual_danger_size_mult).toBe(1);
    expect(b.strategy.narrative_conditioning.compounding_size_mult).toBe(1);
    expect(b.strategy.narrative_conditioning.cautious_spread_mult).toBe(1);
    expect(b.strategy.narrative_conditioning.cautious_size_mult).toBe(1);
    expect(b.strategy.narrative_conditioning.oscillating_size_mult).toBe(1);
    expect(b.strategy.stale_quote.min_spread_mult).toBe(1);
  });

  it("makes the mutual-danger sustained window practically unreachable", () => {
    const b = baselinePolicy(policy);
    expect(b.model.mutual_danger.min_duration_ms).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps the stoppage-time zero-lambda BUG FIX active for both agents (not an opinion to ablate)", () => {
    const b = baselinePolicy(policy);
    expect(b.model.stoppage.min_fraction).toBe(policy.model.stoppage.min_fraction);
    expect(b.model.stoppage.min_fraction).toBeGreaterThan(0);
  });

  it("does not mutate the original policy object", () => {
    const before = JSON.stringify(policy);
    baselinePolicy(policy);
    expect(JSON.stringify(policy)).toBe(before);
  });

  it("still validates as internally consistent (schema_version, dc_rho, etc unchanged)", () => {
    const b = baselinePolicy(policy);
    expect(b.schema_version).toBe(policy.schema_version);
    expect(b.model.dc_rho).toBe(policy.model.dc_rho);
  });
});

describe("runArena — same feed, same engine, two policies, independently hash-chained", () => {
  it("both sides produce a valid hash chain over the identical corpus", () => {
    const corpus = generateSyntheticCorpus();
    const result = runArena(corpus, policy);
    expect(verifyChain(result.tissue.ledger.all()).ok).toBe(true);
    expect(verifyChain(result.baseline.ledger.all()).ok).toBe(true);
    expect(result.tissue.ledger.length).toBe(corpus.length);
    expect(result.baseline.ledger.length).toBe(corpus.length);
  });

  it("the two agents diverge — enabling regimes actually changes decisions, it's not a no-op wrapper", () => {
    const corpus = generateSyntheticCorpus();
    const result = runArena(corpus, policy);
    expect(result.tissue.ledger.headHash).not.toBe(result.baseline.ledger.headHash);
  });

  it("is deterministic — rerunning produces identical grades for both agents", () => {
    const corpus = generateSyntheticCorpus();
    const a = runArena(corpus, policy);
    const b = runArena(corpus, policy);
    expect(a.tissueGrade).toEqual(b.tissueGrade);
    expect(a.baselineGrade).toEqual(b.baselineGrade);
  });

  it("summarizeArena reports the same fixtureId and a well-defined edge", () => {
    const corpus = generateSyntheticCorpus();
    const result = runArena(corpus, policy);
    const summary = summarizeArena(result);
    expect(summary.fixtureId).toBe(result.tissue.fixtureId);
    expect(summary.clvEdgeBps).toBe(result.tissueGrade.clv.meanClvBps - result.baselineGrade.clv.meanClvBps);
    expect(summary.brierEdge).toBe(result.tissueGrade.brier.brier - result.baselineGrade.brier.brier);
  });
});
