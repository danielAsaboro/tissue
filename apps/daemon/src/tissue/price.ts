import {
  type Bps,
  type MarketKey,
  type OddsVector,
  type ProbVector,
  type TissueMarketPrice,
  type Lambdas,
  bps,
  clampBps,
  probToMilliOdds,
} from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { scoreMatrix } from "./poisson.js";
import { outcome1x2, outcomeTotals } from "./outcomes.js";
import { type BaseLambdas } from "./solve.js";
import { type InPlayState, remainingLambdas } from "./inplay.js";

/**
 * Top-level tissue pricer. Given frozen base lambdas + current match state, produces the
 * desk's independent fair price for each enabled market as FIXED-POINT (integer bps + milli
 * odds). Every value here is deterministic and integer-rounded — this is what the ledger
 * hashes and what replay must reproduce bit-for-bit.
 */

export interface TissueState extends InPlayState {
  readonly homeScore: number;
  readonly awayScore: number;
  /** Sustained simultaneous high-pressure window (state/matchState.ts) — a strategy-layer
   *  spread/size overlay (reservation.ts), not a pricing-lambda input. */
  readonly mutualDangerActive: boolean;
}

export interface PricedMarkets {
  readonly lambdas: Lambdas;
  readonly pressureApplied: boolean;
  readonly markets: readonly TissueMarketPrice[];
}

function toBps(p: number): Bps {
  return clampBps(p * 10000);
}

function vecToOdds(v: ProbVector): OddsVector {
  const out: Record<string, ReturnType<typeof probToMilliOdds>> = {};
  for (const k of Object.keys(v)) out[k] = probToMilliOdds(v[k]!);
  return out as OddsVector;
}

/** Normalize a 1X2 triple to bps summing to exactly 10000 (largest-remainder rounding). */
function normalize1x2(home: number, draw: number, away: number): ProbVector {
  return largestRemainder({ HOME: home, DRAW: draw, AWAY: away });
}

function normalizeTotals(over: number, under: number): ProbVector {
  return largestRemainder({ OVER: over, UNDER: under });
}

/** Round a probability map to integer bps that sum to exactly 10000 (deterministic). */
function largestRemainder(probs: Record<string, number>): ProbVector {
  const keys = Object.keys(probs);
  const sum = keys.reduce((s, k) => s + probs[k]!, 0) || 1;
  const scaled = keys.map((k) => ({ k, exact: (probs[k]! / sum) * 10000 }));
  const floored = scaled.map((s) => ({ ...s, floor: Math.floor(s.exact), rem: s.exact - Math.floor(s.exact) }));
  const remaining = 10000 - floored.reduce((s, f) => s + f.floor, 0);
  floored.sort((a, b) => b.rem - a.rem);
  const out: Record<string, Bps> = {};
  for (let i = 0; i < floored.length; i++) {
    const bump = i < remaining ? 1 : 0;
    out[floored[i]!.k] = bps(floored[i]!.floor + bump);
  }
  return out as ProbVector;
}

export function priceMarkets(
  base: BaseLambdas,
  state: TissueState,
  policy: Policy,
): PricedMarkets {
  const rem = remainingLambdas(base, state, {
    regulationMinutes: policy.model.match_regulation_minutes,
    extraTimeMinutes: policy.model.match_extra_time_minutes,
    redOffendingMult: policy.model.red_card.offending_side_attack_mult,
    redOpponentMult: policy.model.red_card.opponent_side_attack_mult,
    pressureEnabled: policy.model.pressure.enabled,
    pressureMaxAbs: policy.model.pressure.max_abs_adjustment,
    stoppageMinFraction: policy.model.stoppage.min_fraction,
    stoppageLambdaMult: policy.model.stoppage.lambda_mult,
  });

  const matrix = scoreMatrix(rem.home, rem.away, policy.model.dc_rho, policy.model.max_goals_per_side);
  const markets: TissueMarketPrice[] = [];

  if (policy.markets.markets_enabled.includes("1X2")) {
    const o = outcome1x2(matrix, state.homeScore, state.awayScore);
    const fairProb = normalize1x2(o.home, o.draw, o.away);
    const key: MarketKey = { market: "1X2" };
    markets.push({ marketKey: key, fairProb, fairOdds: vecToOdds(fairProb) });
  }

  if (policy.markets.markets_enabled.includes("TOTALS")) {
    const lineTimes10 = 25; // O/U 2.5 headline line; corpus totals use this line
    const t = outcomeTotals(matrix, state.homeScore, state.awayScore, lineTimes10 / 10);
    const fairProb = normalizeTotals(t.over, t.under);
    const key: MarketKey = { market: "TOTALS", lineTimes10 };
    markets.push({ marketKey: key, fairProb, fairOdds: vecToOdds(fairProb) });
  }

  return {
    lambdas: { homeMilli: Math.round(rem.home * 1000), awayMilli: Math.round(rem.away * 1000) },
    pressureApplied: policy.model.pressure.enabled && (state.homePressure !== 0 || state.awayPressure !== 0),
    markets,
  };
}

export { toBps };
