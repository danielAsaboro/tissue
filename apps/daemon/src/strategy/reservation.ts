import type { NarrativeRegime, RadarClass } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { staleQuoteSpreadMult } from "./staleQuote.js";

/**
 * Avellaneda–Stoikov-adapted reservation price + spread (Avellaneda & Stoikov, 2008,
 * "High-frequency trading in a limit order book", Quantitative Finance 8(3):217-224).
 * Pure. [LANE: Tim].
 *
 * Adapted to a probability-denominated betting book: the reservation probability is the
 * fair (tissue) probability shifted AGAINST inventory so quotes mean-revert holdings to
 * zero. Two-sided quotes sit at reservation ± half-spread; the half-spread widens with feed
 * staleness (adverse selection, PRD §5) and is conditioned on the Radar signal class.
 */

export interface ReservationInputs {
  /** Fair probability from tissue (bps, 0..10000). */
  readonly fairProbBps: number;
  /** Signed normalized inventory in this selection, roughly [-1,1]; + = net long. */
  readonly inventoryNorm: number;
  /** Feed staleness in ms (0 = fresh). */
  readonly stalenessMs: number;
  readonly radarClass: RadarClass | undefined;
  /** Discretionary added time (tissue/inplay.ts) — elevated variance, unknown clock end. */
  readonly stoppageActive: boolean;
  /** Sustained simultaneous both-sides pressure (state/matchState.ts) — bimodal next-goal
   *  window; widen instead of trusting the Poisson point estimate's confidence. */
  readonly mutualDangerActive: boolean;
  /** Rolling market REGIME (radar/narrative.ts) — a persistently nervous market widens
   *  further on top of any single-event Radar conditioning. */
  readonly narrativeRegime: NarrativeRegime;
  /** Age (ms) of the desk's own currently resting quote on this selection (staleQuote.ts,
   *  max across BACK/LAY) — compresses spread as it ages unchallenged, bounded. */
  readonly restingQuoteAgeMs: number;
}

export interface Quote {
  /** Probability (bps) at which we BACK (buy the outcome) — below reservation. */
  readonly backProbBps: number;
  /** Probability (bps) at which we LAY (sell the outcome) — above reservation. */
  readonly layProbBps: number;
  readonly reservationProbBps: number;
  readonly halfSpreadBps: number;
}

function clampBps(x: number): number {
  return Math.max(1, Math.min(9999, Math.round(x)));
}

export function reservationQuote(inp: ReservationInputs, policy: Policy): Quote {
  const s = policy.strategy;

  // Inventory skew: shift reservation down when long (encourage selling), up when short.
  const skew = s.gamma_inventory * inp.inventoryNorm * 10000;
  const reservationProbBps = clampBps(inp.fairProbBps - skew);

  // Half-spread: base + staleness component, then Radar conditioning.
  const staleAdd = (inp.stalenessMs / 1000) * s.stale_spread_bps_per_sec;
  let halfSpread = s.base_spread_bps + staleAdd;
  if (inp.stoppageActive) halfSpread *= s.stoppage_spread_mult;
  if (inp.mutualDangerActive) halfSpread *= s.mutual_danger_spread_mult;
  if (inp.narrativeRegime === "cautious") halfSpread *= s.narrative_conditioning.cautious_spread_mult;
  halfSpread *= radarSpreadMultiplier(inp.radarClass, policy);
  halfSpread *= staleQuoteSpreadMult(inp.restingQuoteAgeMs, {
    decayMs: s.stale_quote.decay_ms,
    minSpreadMult: s.stale_quote.min_spread_mult,
  });

  const half = Math.max(1, Math.round(halfSpread));
  return {
    backProbBps: clampBps(reservationProbBps - half),
    layProbBps: clampBps(reservationProbBps + half),
    reservationProbBps,
    halfSpreadBps: half,
  };
}

export function radarSpreadMultiplier(radarClass: RadarClass | undefined, policy: Policy): number {
  if (!radarClass) return 1;
  const rc = policy.strategy.radar_conditioning;
  if (rc.aggressive_classes.includes(radarClass)) return rc.aggressive_spread_mult;
  if (rc.widen_classes.includes(radarClass)) return rc.widen_spread_mult;
  return 1;
}
