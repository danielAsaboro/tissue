/**
 * Capped fractional-Kelly sizing (PRD §2). Pure. [LANE: Tim].
 *
 * For a back bet at decimal odds o with our own estimated true probability p (the tissue
 * price), the Kelly-optimal fraction of bankroll is f* = (p·o − 1)/(o − 1). We stake
 * `kellyFraction · f*` of bankroll, then clamp to [min, max] stake. Negative/zero f* ⇒ no
 * bet (the edge is not in our favor at these odds).
 */

export function kellyFraction(pTrue: number, decimalOdds: number): number {
  if (decimalOdds <= 1) return 0;
  const b = decimalOdds - 1;
  const f = (pTrue * decimalOdds - 1) / b;
  return f > 0 ? Math.min(f, 1) : 0;
}

export interface KellyConfig {
  readonly kellyFraction: number;
  readonly bankrollUnits: number;
  readonly minStakeUnits: number;
  readonly maxStakeUnits: number;
}

/** Integer stake in Units. Returns 0 when Kelly says no bet or the stake rounds below min. */
export function fractionalKellyStake(pTrue: number, decimalOdds: number, cfg: KellyConfig): number {
  const f = kellyFraction(pTrue, decimalOdds);
  if (f <= 0) return 0;
  const raw = Math.round(cfg.kellyFraction * f * cfg.bankrollUnits);
  if (raw < cfg.minStakeUnits) return 0;
  return Math.min(raw, cfg.maxStakeUnits);
}
