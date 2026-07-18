import { describe, expect, it } from "vitest";
import { bps, millis, milliOdds, type Edge, type ExposureSnapshot, type HaltSignal, type MarketId } from "@tissue/shared";
import { loadPolicy } from "../config/policy.js";
import type { QuoteProposal } from "../strategy/strategy.js";
import { evaluateRisk, type RiskContext } from "./gates.js";

const policy = loadPolicy();

const baseExposure: ExposureSnapshot = {
  perMarketUnits: {},
  perFixtureUnits: 0,
  openIntents: 0,
  realizedPnlUnits: 0,
  peakEquityUnits: 0,
  drawdownUnits: 0,
};

function ctx(o: Partial<RiskContext>): RiskContext {
  return { feedGapMs: 0, radarHalts: [], edges: [], exposure: baseExposure, killed: false, ...o };
}

function proposal(sizeUnits: number, market: MarketId = "1X2"): QuoteProposal {
  return {
    marketKey: { market },
    selection: "HOME",
    side: "BACK",
    priceMilliOdds: 2000,
    sizeUnits,
    edgeBps: 300,
    radarClass: undefined,
    reason: "test",
  };
}

describe("risk gates — THE only module authorized to green-light execution", () => {
  it("drawdown kill latches, rejects everything, and stays killed even below the threshold once ctx.killed is true", () => {
    const props = [proposal(100)];
    const atThreshold = evaluateRisk(props, ctx({ exposure: { ...baseExposure, drawdownUnits: policy.risk.drawdown_kill_units } }), policy);
    expect(atThreshold.killed).toBe(true);
    expect(atThreshold.approved).toHaveLength(0);
    expect(atThreshold.rejected).toHaveLength(1);

    const latched = evaluateRisk(props, ctx({ killed: true, exposure: { ...baseExposure, drawdownUnits: 0 } }), policy);
    expect(latched.killed).toBe(true);
    expect(latched.approved).toHaveLength(0);
  });

  it("stale-feed hard halt cancels everything (scope ALL) before any exposure math runs", () => {
    const result = evaluateRisk([proposal(100)], ctx({ feedGapMs: policy.feed.max_gap_ms }), policy);
    expect(result.killed).toBe(false);
    expect(result.halts).toHaveLength(1);
    expect(result.halts[0]!.scope).toBe("ALL");
    expect(result.halts[0]!.reason).toBe("feed-gap");
    expect(result.approved).toHaveLength(0);
  });

  it("unexplained-movement halts only the affected market, not the whole desk", () => {
    const halt: HaltSignal = {
      reason: "unexplained-movement",
      marketKey: { market: "1X2" },
      triggerMsgId: "m1",
      ts: millis(0),
      detail: "odds moved, no event",
    };
    const result = evaluateRisk([proposal(100, "1X2"), proposal(100, "TOTALS")], ctx({ radarHalts: [halt] }), policy);
    expect(result.halts.find((h) => h.reason === "unexplained-movement")?.scope).toBe("MARKET");
    expect(result.rejected.some((r) => r.reason === "market-halted")).toBe(true);
    // TOTALS was never halted, so it must not be rejected as market-halted.
    expect(result.rejected.filter((r) => r.reason === "market-halted")).toHaveLength(1);
  });

  it("model-divergence beyond the policy band pulls the market and flags it", () => {
    const edge: Edge = {
      marketKey: { market: "1X2" },
      selection: "HOME",
      tissueProb: bps(9000),
      marketProb: bps(1000),
      edgeBps: policy.risk.model_divergence_band_bps + 1,
      fairOdds: milliOdds(1111),
      marketOdds: milliOdds(10000),
    };
    const result = evaluateRisk([proposal(100)], ctx({ edges: [edge] }), policy);
    expect(result.halts.some((h) => h.reason === "model-divergence")).toBe(true);
    expect(result.flags.some((f) => f.includes("model-divergence"))).toBe(true);
    expect(result.rejected.some((r) => r.reason === "market-halted")).toBe(true);
  });

  it("rejects a proposal that would breach the per-market exposure cap", () => {
    const over = policy.risk.exposure_cap_per_market_units + 1;
    const result = evaluateRisk([proposal(over)], ctx({}), policy);
    expect(result.rejected).toEqual([{ proposal: expect.objectContaining({ sizeUnits: over }), reason: "market-exposure-cap" }]);
    expect(result.approved).toHaveLength(0);
  });

  it("rejects a proposal that would breach the per-fixture exposure cap even under the per-market cap", () => {
    const size = Math.min(policy.risk.exposure_cap_per_market_units, policy.risk.exposure_cap_per_fixture_units + 1);
    const result = evaluateRisk(
      [proposal(size)],
      ctx({ exposure: { ...baseExposure, perFixtureUnits: policy.risk.exposure_cap_per_fixture_units } }),
      policy,
    );
    expect(result.rejected.some((r) => r.reason === "fixture-exposure-cap")).toBe(true);
  });

  it("rejects once max_open_intents is reached, even with exposure headroom", () => {
    const result = evaluateRisk(
      [proposal(1)],
      ctx({ exposure: { ...baseExposure, openIntents: policy.risk.max_open_intents } }),
      policy,
    );
    expect(result.rejected).toEqual([{ proposal: expect.objectContaining({ sizeUnits: 1 }), reason: "max-open-intents" }]);
  });

  it("accumulates fixture exposure cumulatively across proposals on different markets in one call", () => {
    const size = Math.floor(policy.risk.exposure_cap_per_market_units / 2);
    const result = evaluateRisk([proposal(size, "1X2"), proposal(size, "TOTALS")], ctx({}), policy);
    expect(result.approved).toHaveLength(2);
    const approvedTotal = result.approved.reduce((s, p) => s + p.sizeUnits, 0);
    expect(approvedTotal).toBe(2 * size);
  });

  it("a third proposal that would push cumulative fixture exposure over the cap is rejected, not silently capped", () => {
    const nearCap = policy.risk.exposure_cap_per_fixture_units - 10;
    const result = evaluateRisk(
      [proposal(20, "1X2")],
      ctx({ exposure: { ...baseExposure, perFixtureUnits: nearCap, perMarketUnits: { "1X2": 0 } } }),
      policy,
    );
    expect(result.approved).toHaveLength(0);
    expect(result.rejected[0]!.reason).toBe("fixture-exposure-cap");
  });
});
