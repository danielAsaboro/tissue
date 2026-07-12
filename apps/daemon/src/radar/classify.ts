import type { MarketKey, RadarClass, RadarTriggerEvent } from "@tissue/shared";
import type { LatencyBand } from "./percentiles.js";
import { percentileOf } from "./percentiles.js";

/**
 * Pure Radar classifier. Given a finalized reaction summary + the empirical band + policy
 * thresholds, assign a signal class. [LANE: Daniel] — this taxonomy is a first pass; the
 * class set and thresholds are his to redesign/calibrate (T5). Deterministic, no clock.
 */

export interface ReactionSummary {
  readonly marketKey: MarketKey;
  readonly triggerEvent: RadarTriggerEvent;
  readonly hadEvent: boolean;
  readonly minuteAtEvent: number;
  readonly firstReactionTs: number | undefined;
  readonly reactionLatencyMs: number | undefined;
  readonly peakMagnitudeBps: number;
  readonly finalMagnitudeBps: number;
  /** Fraction of the peak move that had retraced by finalization (0..1). */
  readonly retraceFraction: number;
  /** Adverse drop (bps) of the pre-event favorite (1X2 only; 0 otherwise). */
  readonly favoriteDropBps: number;
  /** Rise (bps) in DRAW probability (1X2 only; 0 otherwise). */
  readonly drawRiseBps: number;
}

export interface ClassifyConfig {
  readonly significantBps: number;
  readonly overreactionRetracePct: number;
  readonly drawWatchAfterMinute: number;
  readonly drawCompressionBps: number;
  /** favorite-panic first-pass threshold; Daniel to calibrate. */
  readonly favoritePanicBps: number;
}

export interface Classification {
  readonly signalClass: RadarClass;
  readonly latencyPercentile: number | undefined;
}

export function classifyReaction(
  s: ReactionSummary,
  band: LatencyBand,
  cfg: ClassifyConfig,
  latencySamples: readonly number[],
): Classification {
  // 1. No event explains a significant move ⇒ adverse-selection HALT trigger.
  if (!s.hadEvent) {
    return { signalClass: "unexplained-movement", latencyPercentile: undefined };
  }

  // 2. Event happened but the market never reacted significantly within the window.
  if (s.firstReactionTs === undefined || s.finalMagnitudeBps < cfg.significantBps) {
    return { signalClass: "stale-line", latencyPercentile: undefined };
  }

  // 3. The move overshot then retraced past the threshold.
  if (s.retraceFraction * 100 >= cfg.overreactionRetracePct) {
    return { signalClass: "overreaction", latencyPercentile: pctOrUndef(s, latencySamples) };
  }

  // 4. The pre-event favorite collapsed sharply.
  if (s.favoriteDropBps >= cfg.favoritePanicBps) {
    return { signalClass: "favorite-panic", latencyPercentile: pctOrUndef(s, latencySamples) };
  }

  // 5. Late-match draw compression.
  if (s.minuteAtEvent >= cfg.drawWatchAfterMinute && s.drawRiseBps >= cfg.drawCompressionBps) {
    return { signalClass: "draw-compression", latencyPercentile: pctOrUndef(s, latencySamples) };
  }

  // 6/7. Speed classification against the empirical band.
  const lat = s.reactionLatencyMs ?? 0;
  if (lat > band.slowMs) return { signalClass: "late-reaction", latencyPercentile: pctOrUndef(s, latencySamples) };
  if (lat < band.fastMs) return { signalClass: "fast-reaction", latencyPercentile: pctOrUndef(s, latencySamples) };
  // Within band: assign to the nearer edge so every reaction carries a class.
  const mid = (band.fastMs + band.slowMs) / 2;
  return {
    signalClass: lat <= mid ? "fast-reaction" : "late-reaction",
    latencyPercentile: pctOrUndef(s, latencySamples),
  };
}

function pctOrUndef(s: ReactionSummary, samples: readonly number[]): number | undefined {
  return s.reactionLatencyMs === undefined ? undefined : percentileOf(samples, s.reactionLatencyMs);
}
