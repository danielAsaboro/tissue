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
 * never import daemon internals or read the ledger directly. Production resolves this
 * interface through the daemon's read-only HTTP evidence API.
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
  /** True only for explicit replay data. Live quote publication is always false. */
  readonly simulated: boolean;
}

export interface HaltState {
  readonly kind: "waiting" | "verifying" | "watching" | "quoting" | "halted" | "error";
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

export interface AnchorEvidenceRow {
  readonly messageId: string;
  readonly ts: number;
  readonly method: "view" | "transaction";
  readonly status: "verified" | "confirmed" | "rejected" | "failed";
  readonly result: boolean;
  readonly rootPda: string;
  readonly programId: string;
  readonly txSig?: string;
  readonly error?: string;
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
  getGradeSheet(): Promise<GradeSheet | null>;
  getReplayControl(): Promise<ReplayControl>;
  getAnchorEvidence(): Promise<readonly AnchorEvidenceRow[]>;
}
