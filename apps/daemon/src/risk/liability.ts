import type { Side } from "@tissue/shared";

/**
 * Maximum loss for exchange-style quote volume. `sizeUnits` is backer stake: BACK risks
 * the stake, while LAY risks stake × (decimal odds − 1). Risk gates must cap this number,
 * never raw matched volume, or a long-odds lay silently exceeds its capital limit.
 */
export function quoteLiabilityUnits(side: Side, priceMilliOdds: number, sizeUnits: number): number {
  if (!Number.isSafeInteger(priceMilliOdds) || priceMilliOdds < 1_000) {
    throw new Error(`quote odds must be safe milli-odds >= 1000; received ${priceMilliOdds}`);
  }
  if (!Number.isSafeInteger(sizeUnits) || sizeUnits < 0) {
    throw new Error(`quote size must be a non-negative safe integer; received ${sizeUnits}`);
  }
  if (side === "BACK") return sizeUnits;
  // Round half-up in fixed point. Multiplying as BigInt avoids losing integer precision
  // before the safe-range check when both inputs are individually safe integers.
  const numerator = BigInt(sizeUnits) * BigInt(priceMilliOdds - 1_000);
  const liability = (numerator + 500n) / 1_000n;
  if (liability > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("lay liability exceeds safe integer range");
  }
  return Number(liability);
}
