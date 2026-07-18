import type { MatchPhase } from "@tissue/shared";
import type { BaseLambdas } from "./solve.js";

/**
 * In-play adjustment of the frozen base (full-match) lambdas into REMAINING-match lambdas:
 *   lambda_rem = lambda_base * f(t_rem)  ·  × red-card multipliers  ·  × bounded pressure.
 * Pure. Pressure scalars are pre-decayed in state/ and passed in; here they only apply a
 * bounded multiplier (the flagged on/off heuristic lives behind `pressureEnabled`).
 */

export type { MatchPhase };

export interface InPlayState {
  readonly minute: number;
  readonly homeReds: number;
  readonly awayReds: number;
  /** Pre-decayed attacking-pressure scalars in [-1,1]; 0 = neutral. */
  readonly homePressure: number;
  readonly awayPressure: number;
  /** "regulation" default; ET goals still count, penalties do not (see soccerFeed.ts). */
  readonly matchPhase: MatchPhase;
  /** Discretionary added time at the end of a period — real live time, unknown end. */
  readonly stoppageActive: boolean;
}

export interface InPlayConfig {
  readonly regulationMinutes: number;
  readonly extraTimeMinutes: number;
  readonly redOffendingMult: number;
  readonly redOpponentMult: number;
  readonly pressureEnabled: boolean;
  readonly pressureMaxAbs: number;
  /** Flagged heuristic (same honesty framing as the pressure modifier): stoppage-time goal
   *  probability runs elevated versus mid-period play, but the exact effect is a modeling
   *  assumption, not a fitted/validated microstructure fact. Bounded and policy-controlled. */
  readonly stoppageMinFraction: number;
  readonly stoppageLambdaMult: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Total minutes in the current phase's goal-scoring window: 90 in regulation, 90+ET once
 * extra time has started (ET goals count toward 1X2/totals), unchanged in penalties (the
 * window already closed at the end of ET — see soccerFeed.ts::isPenaltiesPhase).
 */
export function phaseTotalMinutes(
  matchPhase: MatchPhase,
  regulationMinutes: number,
  extraTimeMinutes: number,
): number {
  return matchPhase === "regulation" ? regulationMinutes : regulationMinutes + extraTimeMinutes;
}

/**
 * Remaining fraction of the current phase's goal-scoring window, clamped to [0,1]. During
 * detected stoppage time the match clock has passed the nominal boundary but real playing
 * time continues with an unknown end — floor to `stoppageMinFraction` instead of hard 0.
 */
export function remainingTimeFraction(
  minute: number,
  totalMinutes: number,
  stoppageActive: boolean,
  stoppageMinFraction: number,
): number {
  const f = (totalMinutes - minute) / totalMinutes;
  if (f <= 0 && stoppageActive) return clamp(stoppageMinFraction, 0, 1);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export function remainingLambdas(
  base: BaseLambdas,
  state: InPlayState,
  cfg: InPlayConfig,
): { home: number; away: number } {
  const total = phaseTotalMinutes(state.matchPhase, cfg.regulationMinutes, cfg.extraTimeMinutes);
  const f = remainingTimeFraction(state.minute, total, state.stoppageActive, cfg.stoppageMinFraction);
  let home = base.home * f;
  let away = base.away * f;
  if (state.stoppageActive) {
    const mult = clamp(cfg.stoppageLambdaMult, 1, 3);
    home *= mult;
    away *= mult;
  }

  // Red cards: the offending side's remaining attack drops, the opponent's rises.
  for (let i = 0; i < state.homeReds; i++) {
    home *= cfg.redOffendingMult;
    away *= cfg.redOpponentMult;
  }
  for (let i = 0; i < state.awayReds; i++) {
    away *= cfg.redOffendingMult;
    home *= cfg.redOpponentMult;
  }

  if (cfg.pressureEnabled) {
    home *= 1 + clamp(state.homePressure, -1, 1) * cfg.pressureMaxAbs;
    away *= 1 + clamp(state.awayPressure, -1, 1) * cfg.pressureMaxAbs;
  }

  return { home: Math.max(home, 0), away: Math.max(away, 0) };
}
