import { describe, expect, it } from "vitest";
import type { MarketId, Selection } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import { evaluateSlipExecution, type SlipExecutionContext, type SlipTradeCandidate } from "./gates.js";

const basePolicy = loadPolicy();

function policyWithSlip(overrides: Partial<Policy["exec"]["slip"]>): Policy {
  return {
    ...basePolicy,
    exec: { ...basePolicy.exec, slip: { ...basePolicy.exec.slip, enabled: true, ...overrides } },
  };
}

function candidate(o: Partial<SlipTradeCandidate> = {}): SlipTradeCandidate {
  return {
    marketKey: { market: "1X2" as MarketId },
    selection: "HOME" as Selection,
    side: "BACK",
    sizeUnits: 1_000_000,
    edgeBps: 300,
    tissueProbBps: 6000,
    ...o,
  };
}

const emptyCtx: SlipExecutionContext = { stakedByMarketUnits: {}, totalStakedUnits: 0 };

describe("evaluateSlipExecution — second, stricter gate for real capital on Slip", () => {
  it("rejects everything when disabled, regardless of how favorable the candidates are", () => {
    const policy = { ...basePolicy, exec: { ...basePolicy.exec, slip: { ...basePolicy.exec.slip, enabled: false } } };
    const result = evaluateSlipExecution([candidate()], emptyCtx, policy);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toBe("slip-execution-disabled");
  });

  it("approves a candidate that clears every threshold", () => {
    const policy = policyWithSlip({ min_edge_bps_to_execute: 250, max_stake_units_per_market: 5_000_000, max_concurrent_markets: 3, max_total_exposure_units: 10_000_000 });
    const result = evaluateSlipExecution([candidate({ edgeBps: 300, sizeUnits: 1_000_000 })], emptyCtx, policy);
    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects an edge below the Slip-specific threshold even though it would clear ordinary quoting", () => {
    const policy = policyWithSlip({ min_edge_bps_to_execute: 250 });
    const result = evaluateSlipExecution([candidate({ edgeBps: 200 })], emptyCtx, policy);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("edge-below-slip-threshold");
  });

  it("rejects LAY and negative-edge intents because Slip only buys the named outcome", () => {
    const policy = policyWithSlip({ min_edge_bps_to_execute: 250 });
    const lay = evaluateSlipExecution([candidate({ side: "LAY", edgeBps: -400 })], emptyCtx, policy);
    expect(lay.approved).toHaveLength(0);
    expect(lay.rejected[0]!.reason).toBe("slip-does-not-support-lay");
    const negativeBack = evaluateSlipExecution([candidate({ side: "BACK", edgeBps: -400 })], emptyCtx, policy);
    expect(negativeBack.rejected[0]!.reason).toBe("edge-below-slip-threshold");
  });

  it("rejects a single stake that exceeds the per-market cap", () => {
    const policy = policyWithSlip({ max_stake_units_per_market: 1_000_000 });
    const result = evaluateSlipExecution([candidate({ sizeUnits: 1_000_001 })], emptyCtx, policy);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("stake-exceeds-per-market-cap");
  });

  it("includes unresolved stake already on the same market in the per-market cap", () => {
    const policy = policyWithSlip({ max_stake_units_per_market: 1_500_000 });
    const result = evaluateSlipExecution(
      [candidate({ sizeUnits: 1_000_000 })],
      { stakedByMarketUnits: { "1X2": 750_000 }, totalStakedUnits: 750_000 },
      policy,
    );
    expect(result.rejected[0]!.reason).toBe("stake-exceeds-per-market-cap");
  });

  it("rejects once the concurrent-market count is already at the cap", () => {
    const policy = policyWithSlip({ max_concurrent_markets: 2 });
    const result = evaluateSlipExecution([candidate()], { stakedByMarketUnits: { "TOTALS@25": 1, "TOTALS@35": 1 }, totalStakedUnits: 2 }, policy);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("max-concurrent-markets");
  });

  it("rejects once total exposure would exceed the aggregate cap, even under the per-market cap", () => {
    const policy = policyWithSlip({ max_stake_units_per_market: 5_000_000, max_total_exposure_units: 3_000_000 });
    const result = evaluateSlipExecution([candidate({ sizeUnits: 1_000_000 })], { stakedByMarketUnits: {}, totalStakedUnits: 2_500_000 }, policy);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("total-exposure-cap");
  });

  it("evaluates candidates greedily in order, so an earlier approval can push a later one over the aggregate cap", () => {
    const policy = policyWithSlip({ max_stake_units_per_market: 5_000_000, max_concurrent_markets: 5, max_total_exposure_units: 1_500_000 });
    const result = evaluateSlipExecution(
      [candidate({ marketKey: { market: "1X2" }, sizeUnits: 1_000_000 }), candidate({ marketKey: { market: "TOTALS", lineTimes10: 25 }, sizeUnits: 1_000_000 })],
      emptyCtx,
      policy,
    );
    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toBe("total-exposure-cap");
  });
});
