/**
 * Fixed-point units. The deterministic core never touches floats in a way that
 * affects a decision — everything a decision depends on is an integer here.
 *
 *  - Bps       : basis points, 0..10000. Probabilities live here (1.00 = 10000).
 *  - MilliOdds : decimal odds × 1000. Matches the sponsor's on-chain `Offer.odds`
 *                encoding (`odds: 2000` = 2.0) — see GROUND-TRUTH.md / feedback.md.
 *  - Units     : integer money (lamport-like). Stakes, exposure, PnL.
 *  - MsgId     : feed message id — the ONLY ordering key the core uses (no wall-clock).
 *  - Millis    : an epoch/feed timestamp in ms; used for measurement/latency, never as
 *                a decision input in the pure core.
 */

export type Bps = number & { readonly __brand: "Bps" };
export type MilliOdds = number & { readonly __brand: "MilliOdds" };
export type Units = number & { readonly __brand: "Units" };
export type Millis = number & { readonly __brand: "Millis" };

export const BPS_ONE = 10000 as Bps;

export const bps = (n: number): Bps => n as Bps;
export const milliOdds = (n: number): MilliOdds => n as MilliOdds;
export const units = (n: number): Units => n as Units;
export const millis = (n: number): Millis => n as Millis;

/** Probability (bps) → fair decimal odds (milli-odds). p must be > 0. */
export function probToMilliOdds(p: Bps): MilliOdds {
  if (p <= 0) return milliOdds(0);
  return milliOdds(Math.round((BPS_ONE / p) * 1000)) as MilliOdds;
}

/** Decimal odds (milli-odds) → implied probability (bps). o must be > 0. */
export function milliOddsToProb(o: MilliOdds): Bps {
  if (o <= 0) return bps(0);
  return bps(Math.round((1000 / o) * BPS_ONE)) as Bps;
}

/** Clamp a bps value to [0, 10000]. */
export function clampBps(n: number): Bps {
  return bps(Math.max(0, Math.min(BPS_ONE, Math.round(n))));
}
