import type {
  DashboardData,
  GaugeState,
  HaltState,
  QuoteTapeRow,
  ReplayControl,
  TissueVsMarketSeries,
} from "../types.js";
import type {
  DecisionRecord,
  GradeSheet,
  RadarEvent,
  TissuePrice,
} from "@tissue/shared";

/**
 * Deterministic mock adapter for the headless dashboard skeleton. No randomness — a
 * fixed synthetic sequence so the skeleton renders identically every run. Replaced by
 * a live adapter over the daemon's flight recorder in the design pass. [LANE: Tim]
 */

const BASE_TS = 1_720_000_000_000;

function tissueVsMarket(): TissueVsMarketSeries {
  const points = Array.from({ length: 24 }, (_, i) => {
    const minute = i * 4;
    // Synthetic: market lags tissue after a goal at minute ~40 (i=10).
    const goal = i >= 10;
    const tissueProbBps = goal ? 5200 + i * 20 : 4600 + i * 15;
    const marketProbBps = goal ? 4900 + i * 18 : 4600 + i * 15;
    return {
      tsMs: BASE_TS + i * 240_000,
      msgId: `mock-${i}`,
      minute,
      tissueProbBps,
      marketProbBps,
    };
  });
  return {
    fixtureId: "MOCK-FIXTURE",
    marketLabel: "1X2",
    selectionLabel: "HOME",
    points,
  };
}

const quoteTape: readonly QuoteTapeRow[] = [
  { tsMs: BASE_TS + 2_400_000, marketLabel: "1X2", selectionLabel: "HOME", side: "BACK", priceMilliOdds: 1920, sizeUnits: 120_000_000, status: "Posted", simulated: true },
  { tsMs: BASE_TS + 2_460_000, marketLabel: "1X2", selectionLabel: "HOME", side: "LAY", priceMilliOdds: 2080, sizeUnits: 120_000_000, status: "Matched", simulated: true },
  { tsMs: BASE_TS + 2_520_000, marketLabel: "TOTALS", selectionLabel: "OVER", side: "BACK", priceMilliOdds: 1850, sizeUnits: 80_000_000, status: "Cancelled", simulated: true },
];

const gauges: GaugeState = {
  inventory: { bySelection: { "1X2:HOME": 60_000_000, "1X2:AWAY": -20_000_000 }, netUnits: 40_000_000 },
  exposure: {
    perMarketUnits: { "1X2": 180_000_000, "TOTALS": 80_000_000 },
    perFixtureUnits: 260_000_000,
    openIntents: 3,
    realizedPnlUnits: 4_200_000,
    peakEquityUnits: 12_000_000,
    drawdownUnits: 0,
  },
};

export class MockDashboardData implements DashboardData {
  readonly network = "devnet" as const;

  async getTissueVsMarket(): Promise<TissueVsMarketSeries> {
    return tissueVsMarket();
  }
  async getLatestTissue(): Promise<TissuePrice | null> {
    return null; // wired by the live adapter
  }
  async getQuoteTape(): Promise<readonly QuoteTapeRow[]> {
    return quoteTape;
  }
  async getRadarEvents(): Promise<readonly RadarEvent[]> {
    return [];
  }
  async getGauges(): Promise<GaugeState> {
    return gauges;
  }
  async getHalt(): Promise<HaltState> {
    return { active: false };
  }
  async getDecisionFeed(): Promise<readonly DecisionRecord[]> {
    return [];
  }
  async verifyHashChain(): Promise<{ ok: boolean; brokenAtSeq?: number }> {
    return { ok: true };
  }
  async getGradeSheet(): Promise<GradeSheet> {
    return {
      generatedAtMsgId: "mock-24",
      clv: { n: 42, meanClvBps: 38, medianClvBps: 30, p25Bps: -10, p75Bps: 85, pctPositive: 0.62 },
      brier: { brier: 0.21, reliability: 0.012, resolution: 0.06, uncertainty: 0.25, bins: [] },
      latency: [{ market: "1X2", n: 30, p10Ms: 1400, p50Ms: 4200, p90Ms: 9100 }],
      perClass: [{ signalClass: "late-reaction", n: 12, hitRate: 0.66, meanClvBps: 55 }],
      pnl: { realizedUnits: 4_200_000, matchedIntents: 8, settlementTxSigs: [], simulated: true },
    };
  }
  async getReplayControl(): Promise<ReplayControl> {
    return { speeds: [1, 5, 25, 100], currentSpeed: 1, playing: false };
  }
}

export const mockDashboardData = new MockDashboardData();
