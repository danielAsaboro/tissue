/**
 * Empirical percentile bands (deterministic, no ML — PRD §1.2). Reaction-latency samples
 * accumulate per market as the corpus grows; a new reaction is "fast" below the fast band
 * and "late" above the slow band. [LANE: Daniel] owns band calibration (T5).
 */

export interface LatencyBand {
  readonly fastMs: number;
  readonly slowMs: number;
}

/** Nearest-rank percentile of a sorted-or-unsorted sample. p in [0,100]. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx]!;
}

/** The percentile a value falls at within a sample (fraction of samples ≤ value, 0..100). */
export function percentileOf(samples: readonly number[], value: number): number {
  if (samples.length === 0) return 50;
  let le = 0;
  for (const s of samples) if (s <= value) le++;
  return (le / samples.length) * 100;
}

/**
 * Compute a band from samples + configured fast/slow percentiles. Falls back to the
 * policy seed band when the sample is too small to be meaningful (< minSamples).
 */
export function computeBand(
  samples: readonly number[],
  fastP: number,
  slowP: number,
  seed: LatencyBand,
  minSamples = 8,
): LatencyBand {
  if (samples.length < minSamples) return seed;
  return { fastMs: percentile(samples, fastP), slowMs: percentile(samples, slowP) };
}
