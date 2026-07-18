import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { verifyChain } from "../ledger/ledger.js";
import { runEngine } from "../replay/engine.js";
import { baselinePolicy } from "./baselinePolicy.js";
import { REGIME_NAMES, regimeOnlyPolicy, runAblationMatrix } from "./ablation.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("regimeOnlyPolicy — isolates exactly one regime from the neutralized baseline", () => {
  it("re-enabling a regime never regresses it below what baselinePolicy already neutralized", () => {
    const base = baselinePolicy(policy);
    for (const regime of REGIME_NAMES) {
      const isolated = regimeOnlyPolicy(policy, regime);
      expect(isolated).not.toEqual(base);
    }
  });

  it("stoppage isolation touches only stoppage fields, leaving every other regime neutralized", () => {
    const base = baselinePolicy(policy);
    const isolated = regimeOnlyPolicy(policy, "stoppage");
    expect(isolated.model.stoppage).toEqual(policy.model.stoppage);
    expect(isolated.strategy.stoppage_spread_mult).toBe(policy.strategy.stoppage_spread_mult);
    // Everything else stays exactly as neutralized as baseline.
    expect(isolated.model.mutual_danger).toEqual(base.model.mutual_danger);
    expect(isolated.strategy.mutual_danger_spread_mult).toBe(base.strategy.mutual_danger_spread_mult);
    expect(isolated.strategy.narrative_conditioning).toEqual(base.strategy.narrative_conditioning);
    expect(isolated.radar.informed_flow).toEqual(base.radar.informed_flow);
    expect(isolated.strategy.stale_quote).toEqual(base.strategy.stale_quote);
  });

  it("informed_flow isolation only re-enables the radar informed-flow flag, nothing else", () => {
    const base = baselinePolicy(policy);
    const isolated = regimeOnlyPolicy(policy, "informed_flow");
    expect(isolated.radar.informed_flow).toEqual(policy.radar.informed_flow);
    expect(isolated.model.stoppage).toEqual(base.model.stoppage);
    expect(isolated.model.mutual_danger).toEqual(base.model.mutual_danger);
    expect(isolated.strategy.narrative_conditioning).toEqual(base.strategy.narrative_conditioning);
    expect(isolated.strategy.stale_quote).toEqual(base.strategy.stale_quote);
  });
});

describe("runAblationMatrix — real head-to-head per regime against the SAME neutralized baseline", () => {
  it("grades every regime against a hash-verified baseline run over the same corpus", () => {
    const corpus = generateSyntheticCorpus();
    const matrix = runAblationMatrix(corpus, policy);
    expect(matrix.rows).toHaveLength(REGIME_NAMES.length);
    expect(new Set(matrix.rows.map((r) => r.regime)).size).toBe(REGIME_NAMES.length);
    for (const row of matrix.rows) {
      expect(row.clvEdgeBps).toBe(row.meanClvBps - matrix.baseline.meanClvBps);
      expect(row.brierEdge).toBeCloseTo(row.brier - matrix.baseline.brier, 10);
    }
  });

  it("each regime's own ledger is independently hash-chain-verifiable (replay(corpus) === ledger per side)", () => {
    const corpus = generateSyntheticCorpus();
    for (const regime of REGIME_NAMES) {
      const result = runEngine(corpus, regimeOnlyPolicy(policy, regime));
      expect(verifyChain(result.ledger.all()).ok).toBe(true);
    }
  });

  it("is deterministic — identical matrix on rerun over the same corpus", () => {
    const corpus = generateSyntheticCorpus();
    const a = runAblationMatrix(corpus, policy);
    const b = runAblationMatrix(corpus, policy);
    expect(a).toEqual(b);
  });
});
