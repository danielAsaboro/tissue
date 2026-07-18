import { percentile } from "./percentiles.js";

/**
 * Consensus-based informed-flow signal (PRD extension, adapted from Glosten-Milgrom 1985 —
 * a market maker should widen/withdraw against informed order flow).
 *
 * HONESTY NOTE: the originally pitched version of this idea classified toxicity from
 * cross-bookmaker propagation patterns (which book moved first, how fast others followed).
 * TxLINE's real feed does not expose that — GROUND-TRUTH.md T2 and the current live docs
 * both confirm the odds stream is a single de-margined StablePrice CONSENSUS, not per-book
 * lines. This is the honest, single-stream adaptation: instead of a fixed bps-magnitude
 * threshold applied uniformly to every market at every point in the match (the existing
 * `unexplained_bps` check), classify a move's VELOCITY (bps moved per second) against THIS
 * market's own recent velocity distribution. A quiet market's normal jitter and a chaotic
 * in-play market's normal jitter are different baselines; a fixed threshold either fires too
 * often on the latter or too rarely on the former. This adapts per market, deterministically,
 * from real observed data — no cross-book fabrication.
 */

export interface InformedFlowConfig {
  /** Percentile of the trailing velocity distribution above which a move is anomalous. */
  readonly toxicPercentile: number;
  /** Minimum trailing samples before trusting the empirical percentile over the seed. */
  readonly minSamples: number;
  /** Fallback velocity threshold (bps/sec) used until minSamples is reached. */
  readonly seedVelocityBpsPerSec: number;
}

/** bps of probability moved per second between two consecutive odds reads on one market. */
export function moveVelocityBpsPerSec(magnitudeBps: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  return magnitudeBps / (dtMs / 1000);
}

/**
 * Is this move's velocity anomalous relative to the market's own recent behavior? Pure,
 * deterministic (nearest-rank percentile, no ML) — same style as the existing latency bands.
 */
export function isInformedFlowVelocity(
  velocityBpsPerSec: number,
  trailingSamples: readonly number[],
  cfg: InformedFlowConfig,
): boolean {
  const threshold =
    trailingSamples.length >= cfg.minSamples
      ? percentile(trailingSamples, cfg.toxicPercentile)
      : cfg.seedVelocityBpsPerSec;
  return velocityBpsPerSec > threshold;
}
