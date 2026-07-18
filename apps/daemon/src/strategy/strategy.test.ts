import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { kellyFraction, fractionalKellyStake } from "./kelly.js";
import { reservationQuote, radarSpreadMultiplier } from "./reservation.js";
import { computeEdges, proposeQuotes, marketMapFromOdds } from "./strategy.js";
import { evaluateRisk } from "../risk/gates.js";
import { ExposureTracker } from "../risk/exposure.js";
import {
  type OddsMessage,
  type Intent,
  bps,
  milliOdds,
  millis,
  type ProbVector,
} from "@tissue/shared";
import type { PricedMarkets } from "../tissue/price.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

function odds(market: "1X2" | "TOTALS", consensus: Record<string, number>): OddsMessage {
  return {
    kind: "odds",
    msgId: `o-${market}`,
    fixtureId: "F",
    ts: millis(0),
    network: "devnet",
    marketKey: market === "1X2" ? { market: "1X2" } : { market: "TOTALS", lineTimes10: 25 },
    consensus: consensus as ProbVector,
    inRunning: true,
  };
}

function priced(homeBps: number, drawBps: number, awayBps: number): PricedMarkets {
  return {
    lambdas: { homeMilli: 1200, awayMilli: 1000 },
    pressureApplied: false,
    markets: [
      {
        marketKey: { market: "1X2" },
        fairProb: { HOME: bps(homeBps), DRAW: bps(drawBps), AWAY: bps(awayBps) } as ProbVector,
        fairOdds: { HOME: milliOdds(Math.round(1e7 / homeBps)), DRAW: milliOdds(Math.round(1e7 / drawBps)), AWAY: milliOdds(Math.round(1e7 / awayBps)) },
      },
    ],
  };
}

describe("kelly", () => {
  it("is positive only with edge, capped to [0,1]", () => {
    expect(kellyFraction(0.6, 2.0)).toBeCloseTo(0.2, 6); // (0.6*2-1)/1
    expect(kellyFraction(0.4, 2.0)).toBe(0); // no edge
    expect(kellyFraction(0.99, 100)).toBeLessThanOrEqual(1);
  });
  it("stakes fractionally and respects min/max", () => {
    const cfg = { kellyFraction: 0.25, bankrollUnits: 1_000_000_000, minStakeUnits: 1_000_000, maxStakeUnits: 50_000_000 };
    const s = fractionalKellyStake(0.6, 2.0, cfg);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(cfg.maxStakeUnits);
    expect(fractionalKellyStake(0.4, 2.0, cfg)).toBe(0);
  });
});

describe("reservation (A-S adapted)", () => {
  it("skews reservation down when long inventory", () => {
    const flat = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    const long = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0.8, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    expect(long.reservationProbBps).toBeLessThan(flat.reservationProbBps);
  });
  it("widens half-spread with staleness and radar class", () => {
    const fresh = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    const stale = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 5000, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    expect(stale.halfSpreadBps).toBeGreaterThan(fresh.halfSpreadBps);
    expect(radarSpreadMultiplier("overreaction", policy)).toBeGreaterThan(1);
    expect(radarSpreadMultiplier("stale-line", policy)).toBeLessThan(1);
  });
  it("widens half-spread during stoppage time", () => {
    const normal = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    const stoppage = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: true, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    expect(stoppage.halfSpreadBps).toBeGreaterThan(normal.halfSpreadBps);
  });
  it("widens half-spread during a mutual-danger window, stacking with other multipliers", () => {
    const normal = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    const mutualDanger = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: true, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    expect(mutualDanger.halfSpreadBps).toBeGreaterThan(normal.halfSpreadBps);
    expect(mutualDanger.halfSpreadBps).toBe(Math.round(normal.halfSpreadBps * policy.strategy.mutual_danger_spread_mult));
  });
  it("compresses half-spread as the desk's own resting quote ages (stale-quote decay)", () => {
    const fresh = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: 0 }, policy);
    const aged = reservationQuote({ fairProbBps: 5000, inventoryNorm: 0, stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", restingQuoteAgeMs: policy.strategy.stale_quote.decay_ms }, policy);
    expect(aged.halfSpreadBps).toBeLessThan(fresh.halfSpreadBps);
    expect(aged.halfSpreadBps).toBe(Math.round(fresh.halfSpreadBps * policy.strategy.stale_quote.min_spread_mult));
  });
});

describe("strategy", () => {
  it("computes signed edge tissue − market", () => {
    const edges = computeEdges(priced(5500, 2600, 1900), marketMapFromOdds([odds("1X2", { HOME: 5000, DRAW: 2800, AWAY: 2200 })]));
    const home = edges.find((e) => e.selection === "HOME")!;
    expect(home.edgeBps).toBe(500);
  });

  it("only proposes when |edge| ≥ threshold", () => {
    const market = marketMapFromOdds([odds("1X2", { HOME: 5450, DRAW: 2650, AWAY: 1900 })]);
    // tissue HOME 5500 vs market 5450 → edge 50 < 150 threshold → no HOME value
    const none = proposeQuotes({ priced: priced(5500, 2650, 1850), market, inventoryNorm: new Map(), stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    expect(none.filter((p) => p.selection === "HOME" && p.reason === "back-value")).toHaveLength(0);

    const market2 = marketMapFromOdds([odds("1X2", { HOME: 5000, DRAW: 2800, AWAY: 2200 })]);
    const some = proposeQuotes({ priced: priced(5500, 2650, 1850), market: market2, inventoryNorm: new Map(), stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    expect(some.length).toBeGreaterThan(0);
  });

  it("never quotes outside the policy odds band (no deep longshots / near-certainties)", () => {
    const market = marketMapFromOdds([odds("1X2", { HOME: 200, DRAW: 300, AWAY: 9500 })]);
    // tissue disagrees hugely on a near-certainty/longshot; proposals must stay in-band.
    const props = proposeQuotes({ priced: priced(9600, 250, 150), market, inventoryNorm: new Map(), stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    for (const p of props) {
      expect(p.priceMilliOdds).toBeGreaterThanOrEqual(policy.strategy.min_quote_odds_milli);
      expect(p.priceMilliOdds).toBeLessThanOrEqual(policy.strategy.max_quote_odds_milli);
    }
  });

  it("unexplained-movement vetoes all quoting", () => {
    const market = marketMapFromOdds([odds("1X2", { HOME: 5000, DRAW: 2800, AWAY: 2200 })]);
    const veto = proposeQuotes({ priced: priced(5800, 2500, 1700), market, inventoryNorm: new Map(), stalenessMs: 0, radarClass: "unexplained-movement", stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    expect(veto).toHaveLength(0);
  });

  it("an aged resting quote compresses the spread of the desk's next quote on that selection", () => {
    const market = marketMapFromOdds([odds("1X2", { HOME: 5000, DRAW: 2800, AWAY: 2200 })]);
    const base = { priced: priced(5500, 2650, 1850), market, inventoryNorm: new Map(), stalenessMs: 0, radarClass: undefined, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral" as const };
    const restingOld = intent("old-back", "1X2", 1000, "BACK");
    const fresh = proposeQuotes({ ...base, openIntents: [], nowTs: 0 }, policy);
    const compressed = proposeQuotes({ ...base, openIntents: [restingOld], nowTs: policy.strategy.stale_quote.decay_ms }, policy);
    const freshBack = fresh.find((p) => p.selection === "HOME" && p.reason === "back-value")!;
    const compressedBack = compressed.find((p) => p.selection === "HOME" && p.reason === "back-value")!;
    expect(freshBack).toBeDefined();
    expect(compressedBack).toBeDefined();
    // Tighter spread on BACK means a HIGHER back price (closer to reservation from below).
    expect(compressedBack.priceMilliOdds).toBeLessThanOrEqual(freshBack.priceMilliOdds);
  });

  it("mutual-danger cuts stake size without vetoing the quote entirely", () => {
    const market = marketMapFromOdds([odds("1X2", { HOME: 5000, DRAW: 2800, AWAY: 2200 })]);
    const inp = { priced: priced(5500, 2650, 1850), market, inventoryNorm: new Map(), stalenessMs: 0, radarClass: undefined };
    const normal = proposeQuotes({ ...inp, stoppageActive: false, mutualDangerActive: false, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    const danger = proposeQuotes({ ...inp, stoppageActive: false, mutualDangerActive: true, narrativeRegime: "neutral", openIntents: [], nowTs: 0 }, policy);
    const normalBack = normal.find((p) => p.selection === "HOME" && p.reason === "back-value");
    const dangerBack = danger.find((p) => p.selection === "HOME" && p.reason === "back-value");
    expect(normalBack).toBeDefined();
    expect(dangerBack).toBeDefined();
    expect(dangerBack!.sizeUnits).toBeLessThan(normalBack!.sizeUnits);
  });
});

function intent(id: string, market: "1X2" | "TOTALS", sizeUnits: number, side: "BACK" | "LAY" = "BACK"): Intent {
  return {
    id, fixtureId: "F",
    marketKey: market === "1X2" ? { market: "1X2" } : { market: "TOTALS", lineTimes10: 25 },
    selection: "HOME", side, priceMilliOdds: milliOdds(2000), sizeUnits: sizeUnits as never,
    filledUnits: 0 as never, status: "Posted", simulated: true, createdMsgId: "m",
    createdTs: millis(0),
  };
}

describe("risk gates (the only exec authorizer)", () => {
  const base = { feedGapMs: 0, radarHalts: [], edges: [], killed: false };

  it("drawdown kill latches and halts everything", () => {
    const exposure = { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: -5_000_000_000, peakEquityUnits: 0, drawdownUnits: 5_000_000_000 };
    const d = evaluateRisk([], { ...base, exposure }, policy);
    expect(d.killed).toBe(true);
    expect(d.halts[0]!.reason).toBe("drawdown-kill");
  });

  it("feed gap halts all", () => {
    const exposure = { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 };
    const d = evaluateRisk([], { ...base, feedGapMs: 999999, exposure }, policy);
    expect(d.halts.some((h) => h.reason === "feed-gap" && h.scope === "ALL")).toBe(true);
  });

  it("rejects proposals breaching per-market exposure cap", () => {
    const exposure = { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 };
    const big = { marketKey: { market: "1X2" as const }, selection: "HOME" as const, side: "BACK" as const, priceMilliOdds: 2000, sizeUnits: policy.risk.exposure_cap_per_market_units + 1, edgeBps: 300, radarClass: undefined, reason: "back-value" };
    const d = evaluateRisk([big], { ...base, exposure }, policy);
    expect(d.approved).toHaveLength(0);
    expect(d.rejected[0]!.reason).toBe("market-exposure-cap");
  });

  it("model divergence flags + halts that market", () => {
    const exposure = { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 };
    const edges = [{ marketKey: { market: "1X2" as const }, selection: "HOME", tissueProb: bps(9000), marketProb: bps(5000), edgeBps: 4000, fairOdds: milliOdds(1100), marketOdds: milliOdds(2000) }];
    const d = evaluateRisk([], { ...base, edges, exposure }, policy);
    expect(d.halts.some((h) => h.reason === "model-divergence")).toBe(true);
    expect(d.flags.length).toBeGreaterThan(0);
  });
});

describe("exposure tracker", () => {
  it("tracks inventory sign, open intents, and drawdown", () => {
    const t = new ExposureTracker(1_000_000_000);
    t.upsertOpen(intent("a", "1X2", 100_000_000, "BACK"));
    t.onFill(intent("a", "1X2", 100_000_000, "BACK"), 100_000_000);
    expect(t.inventorySnapshot().bySelection["1X2:HOME"]).toBe(100_000_000);
    expect(t.openIntentCount()).toBe(1);
    t.onSettle(50_000_000);
    t.onSettle(-80_000_000);
    expect(t.snapshot().drawdownUnits).toBe(80_000_000); // peak 50, now -30 → dd 80
  });
});
