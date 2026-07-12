import type {
  DecisionRecord,
  GradeSheet,
  RadarEvent,
  TissuePrice,
  ExposureSnapshot,
  InventorySnapshot,
  Network,
} from "@tissue/shared";

/**
 * Dashboard data seam (PRD Phase 0). Components consume ONLY these interfaces — they
 * never import daemon internals or read the ledger directly. The mock adapter powers
 * the headless skeleton today; a live adapter (SSE/HTTP over the daemon's flight
 * recorder) drops in behind the same interface later.
 */

export interface TissueVsMarketPoint {
  readonly tsMs: number;
  readonly msgId: string;
  readonly minute: number;
  readonly tissueProbBps: number;
  readonly marketProbBps: number;
}

export interface TissueVsMarketSeries {
  readonly fixtureId: string;
  readonly marketLabel: string;
  readonly selectionLabel: string;
  readonly points: readonly TissueVsMarketPoint[];
}

export interface QuoteTapeRow {
  readonly tsMs: number;
  readonly marketLabel: string;
  readonly selectionLabel: string;
  readonly side: "BACK" | "LAY";
  readonly priceMilliOdds: number;
  readonly sizeUnits: number;
  readonly status: string;
  /** Surfaced verbatim in the UI: a simulated fill is badged 'SIM', never hidden. */
  readonly simulated: boolean;
}

export interface HaltState {
  readonly active: boolean;
  readonly reason?: string;
  readonly sinceMsgId?: string;
}

export interface GaugeState {
  readonly inventory: InventorySnapshot;
  readonly exposure: ExposureSnapshot;
}

export interface ReplayControl {
  readonly speeds: readonly number[];
  readonly currentSpeed: number;
  readonly playing: boolean;
  readonly cursorMsgId?: string;
}

/** Everything the dashboard needs, behind one swappable seam. */
export interface DashboardData {
  readonly network: Network;
  getTissueVsMarket(): Promise<TissueVsMarketSeries>;
  getLatestTissue(): Promise<TissuePrice | null>;
  getQuoteTape(): Promise<readonly QuoteTapeRow[]>;
  getRadarEvents(): Promise<readonly RadarEvent[]>;
  getGauges(): Promise<GaugeState>;
  getHalt(): Promise<HaltState>;
  getDecisionFeed(): Promise<readonly DecisionRecord[]>;
  /** Recompute the hash chain over the decision feed; true iff it verifies. */
  verifyHashChain(): Promise<{ ok: boolean; brokenAtSeq?: number }>;
  getGradeSheet(): Promise<GradeSheet>;
  getReplayControl(): Promise<ReplayControl>;
}
