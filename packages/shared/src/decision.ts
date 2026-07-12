import type { Bps, MilliOdds, Millis, Units } from "./units.js";
import type { MarketKey, Network, Selection } from "./markets.js";
import type { RadarClass } from "./radar.js";

/**
 * Quote / intent surface + the hash-chained decision record (PRD §1.5, §7).
 *
 * EXECUTION NOTE: the sponsor devnet program has no intent-book. `simulated: true`
 * marks every fill that ran through the internal simulated maker book. This flag is
 * surfaced verbatim in logs, the ledger, the dashboard, and the demo — a simulated
 * fill is NEVER presented as a real counterparty fill. See GROUND-TRUTH.md / HANDOFF D-001.
 */

export type Side = "BACK" | "LAY";

export type IntentStatus =
  | "Posted"
  | "PartiallyMatched"
  | "Matched"
  | "Settled"
  | "Cancelled";

export interface Intent {
  readonly id: string;
  readonly fixtureId: string;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side: Side;
  readonly priceMilliOdds: MilliOdds;
  readonly sizeUnits: Units;
  readonly filledUnits: Units;
  readonly status: IntentStatus;
  /** True while any part of this intent's matching is simulated (current book_mode). */
  readonly simulated: boolean;
  readonly createdMsgId: string;
  readonly txSig?: string;
}

export type DecisionAction =
  | "POST"
  | "REPLACE"
  | "CANCEL"
  | "NO_ACTION"
  | "HALT";

export interface InventorySnapshot {
  /** Signed inventory per selection key (Units). Positive = net long that selection. */
  readonly bySelection: Readonly<Record<string, number>>;
  readonly netUnits: number;
}

export interface ExposureSnapshot {
  readonly perMarketUnits: Readonly<Record<string, number>>;
  readonly perFixtureUnits: number;
  readonly openIntents: number;
  readonly realizedPnlUnits: number;
  readonly peakEquityUnits: number;
  readonly drawdownUnits: number;
}

/** Compact deterministic snapshot embedded in each decision record for replay. */
export interface StateSnapshot {
  readonly minute: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeReds: number;
  readonly awayReds: number;
  readonly inventory: InventorySnapshot;
  readonly exposure: ExposureSnapshot;
  readonly feedGapMs: number;
}

/**
 * Hash-chained decision record. `hash = H(prevHash ‖ canonical(record without hash))`.
 * replay(corpus) must reproduce this chain bit-for-bit (CI assertion, PRD §1.5).
 */
export interface DecisionRecord {
  readonly seq: number;
  /** Feed message id that triggered this decision — the ordering key. */
  readonly triggerMsgId: string;
  /** Hash of the triggering feed message payload. */
  readonly triggerHash: string;
  /** Network the triggering feed came from (pricing may be mainnet; anchoring devnet). */
  readonly triggerNetwork: Network;
  readonly ts: Millis;
  readonly action: DecisionAction;
  readonly radarClass?: RadarClass;
  readonly haltReason?: string;
  readonly state: StateSnapshot;
  /** Compact tissue vs market at decision time. */
  readonly tissueProb: Bps;
  readonly marketProb: Bps;
  readonly edgeBps: number;
  readonly intents: readonly Intent[];
  /** On-chain validate_odds anchoring tx for sampled inputs (real), if anchored. */
  readonly anchorTxSig?: string;
  /** Simulated-book settlement/fill tx marker (never a real tx). */
  readonly simulated: boolean;
  readonly prevHash: string;
  readonly hash: string;
}
