import type { Bps, Millis } from "./units.js";
import type { MarketKey } from "./markets.js";

/**
 * Latency Radar (PRD §1.2). Per meaningful event: event ts → first significant
 * reaction ts → stabilization ts + magnitude. Deterministic, empirical bands, no ML.
 * [LANE: Daniel] — threshold calibration (T5) and taxonomy redesign are his.
 */

export type RadarClass =
  | "late-reaction"
  | "fast-reaction"
  | "overreaction"
  | "stale-line"
  | "draw-compression"
  | "favorite-panic"
  | "unexplained-movement";

export const RADAR_CLASSES: readonly RadarClass[] = [
  "late-reaction",
  "fast-reaction",
  "overreaction",
  "stale-line",
  "draw-compression",
  "favorite-panic",
  "unexplained-movement",
];

/** A match event the radar keys reactions against (goal, red, etc.). */
export interface RadarTriggerEvent {
  readonly kind: "goal" | "red_card" | "penalty" | "score_correction" | "none";
  readonly msgId: string;
  readonly ts: Millis;
  readonly minute: number;
}

export interface RadarEvent {
  readonly marketKey: MarketKey;
  readonly triggerEvent: RadarTriggerEvent;
  readonly eventTs: Millis;
  readonly firstReactionTs?: Millis;
  readonly stabilizationTs?: Millis;
  /** Peak magnitude of the market's reaction (bps of probability). */
  readonly magnitudeBps: Bps;
  /** Reaction latency = firstReactionTs − eventTs (ms), when a reaction was seen. */
  readonly reactionLatencyMs?: number;
  readonly signalClass: RadarClass;
  /** Percentile of this reaction latency within the empirical band for its class. */
  readonly latencyPercentile?: number;
}

/** Emitted when unexplained-movement fires — consumed by risk as an adverse-selection HALT. */
export interface HaltSignal {
  readonly reason: "unexplained-movement" | "feed-gap" | "drawdown-kill" | "model-divergence";
  readonly marketKey?: MarketKey;
  readonly triggerMsgId: string;
  readonly ts: Millis;
  readonly detail: string;
}
