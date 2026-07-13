import type { BrierCalibration } from "@tissue/shared";

/**
 * Binary Brier score + Murphy (1973) calibration/refinement decomposition on the HOME-win
 * forecast: BS = reliability − resolution + uncertainty. Reliability (calibration) lower is
 * better; resolution higher is better. The grade sheet publishes this so miscalibration is
 * visible in public — by design (PRD §4). Deterministic.
 */

export interface ForecastOutcome {
  /** Forecast probability of the event (0..1). */
  readonly p: number;
  /** 1 if the event occurred, else 0. */
  readonly outcome: 0 | 1;
}

export function brierDecomposition(pairs: readonly ForecastOutcome[], bins: number): BrierCalibration {
  const n = pairs.length;
  if (n === 0) {
    return { brier: 0, reliability: 0, resolution: 0, uncertainty: 0, bins: [] };
  }

  const brier = pairs.reduce((s, x) => s + (x.p - x.outcome) ** 2, 0) / n;
  const baseRate = pairs.reduce((s, x) => s + x.outcome, 0) / n;
  const uncertainty = baseRate * (1 - baseRate);

  // Bin by forecast probability.
  const buckets: { sumP: number; sumO: number; count: number }[] = Array.from({ length: bins }, () => ({ sumP: 0, sumO: 0, count: 0 }));
  for (const x of pairs) {
    const idx = Math.min(bins - 1, Math.floor(x.p * bins));
    const b = buckets[idx]!;
    b.sumP += x.p;
    b.sumO += x.outcome;
    b.count += 1;
  }

  let reliability = 0;
  let resolution = 0;
  const binOut = buckets
    .filter((b) => b.count > 0)
    .map((b) => {
      const predictedProb = b.sumP / b.count;
      const observedFreq = b.sumO / b.count;
      reliability += (b.count / n) * (predictedProb - observedFreq) ** 2;
      resolution += (b.count / n) * (observedFreq - baseRate) ** 2;
      return { predictedProb, observedFreq, count: b.count };
    });

  return { brier, reliability, resolution, uncertainty, bins: binOut };
}
