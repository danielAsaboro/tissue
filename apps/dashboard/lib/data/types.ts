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
  /** "Receipts over promises": the hash-chained decision record this quote came from, the
   *  exact TxLINE proof messageId it was verified against, and a real explorer link when an
   *  on-chain anchoring tx exists for that proof. */
  readonly decisionHash?: string;
  readonly proofMessageId: string;
  readonly explorerUrl?: string;
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

/**
 * Venue-neutral durable execution evidence. Slip is the only registered adapter today;
 * every future adapter must provide the same real signing and lifecycle evidence before it
 * can appear here. Rows link to their originating decision through decisionSeq.
 */
export interface VenueExecutionRow {
  readonly venue: string;
  readonly decisionSeq: number;
  readonly marketKey: { readonly market: string; readonly lineTimes10?: number };
  readonly selection: string;
  readonly side?: "BACK" | "LAY";
  readonly edgeBps: number;
  readonly tissueProbBps?: number;
  readonly sizeUnits: number;
  readonly status: "confirmed" | "failed" | "rejected-by-gate";
  readonly venueMarketId?: string;
  readonly venuePositionId?: string;
  readonly submissionTxSig?: string;
  readonly submittedAt: number;
  readonly error?: string;
  readonly lifecycleStatus?: "open" | "resolved" | "claimed" | "voided" | "refunded" | "attention-required";
  readonly lifecycleUpdatedAt?: number;
  readonly settlementTxSig?: string;
  readonly claimTxSig?: string;
  readonly voidTxSig?: string;
  readonly refundTxSig?: string;
  readonly lifecycleError?: string;
  readonly venueBreakevenProbBps?: number;
  readonly venueEdgeBps?: number;
  readonly projectedPayoutAtomic?: string;
}

/**
 * On-chain commitment timeline: the pre-kickoff "Proof of Edge" snapshot plus every periodic
 * checkpoint of the ledger head hash anchored through the match (exec/preMatchCommit.ts,
 * exec/periodicAnchor.ts) — real SPL Memo transactions, not per-message validate_odds proof
 * (that's AnchorEvidenceRow above).
 */
export interface CommitmentTimelineRow {
  readonly kind: "pre-match" | "checkpoint";
  readonly seq?: number;
  readonly submittedAt: number;
  readonly status: "confirmed" | "failed";
  readonly hash: string;
  readonly txSig?: string;
  readonly error?: string;
}

/**
 * Strategy Arena: the SAME feed through the SAME deterministic engine with every flagged
 * heuristic/regime neutralized (baselinePolicy) vs the full desk — a real head-to-head
 * computed on demand from the fixture's authoritative corpus, not a second continuously
 * running live session.
 */
export interface ArenaSummary {
  readonly available: boolean;
  readonly reason?: string;
  readonly fixtureId?: string;
  readonly tissue?: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  readonly baseline?: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  readonly clvEdgeBps?: number;
  readonly brierEdge?: number;
}

/**
 * N-way regime ablation: each flagged heuristic isolated one at a time against the SAME
 * neutralized baseline (arena/ablation.ts) — which regime earns its keep, not just the
 * bundled effect runArena reports.
 */
export interface AblationRow {
  readonly regime: string;
  readonly meanClvBps: number;
  readonly clvN: number;
  readonly brier: number;
  readonly clvEdgeBps: number;
  readonly brierEdge: number;
}

export interface AblationMatrixSummary {
  readonly available: boolean;
  readonly reason?: string;
  readonly fixtureId?: string;
  readonly baseline?: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  readonly rows?: readonly AblationRow[];
}

/** One point per decision, from the already-tracked ExposureSnapshot embedded in every
 *  DecisionRecord — no new backend calculation, just plotted instead of left in raw JSON. */
export interface EquityCurvePoint {
  readonly seq: number;
  readonly tsMs: number;
  readonly minute: number;
  readonly realizedPnlUnits: number;
  readonly peakEquityUnits: number;
  readonly drawdownUnits: number;
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
  getArenaSummary(): Promise<ArenaSummary>;
  getAblationMatrix(): Promise<AblationMatrixSummary>;
  getCommitmentTimeline(): Promise<readonly CommitmentTimelineRow[]>;
  getEquityCurve(): Promise<readonly EquityCurvePoint[]>;
  getVenueExecutions(): Promise<readonly VenueExecutionRow[]>;
  /** The fixture the dashboard's other data methods implicitly resolve to — needed by the
   *  in-browser verifier (VerifyPanel), which must know which fixture a decision seq
   *  belongs to before it can look it up in the public /record export. */
  getActiveFixtureId(): Promise<string | null>;
}
