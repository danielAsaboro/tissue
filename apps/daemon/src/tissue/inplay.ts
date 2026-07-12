import type { BaseLambdas } from "./solve.js";

/**
 * In-play adjustment of the frozen base (full-match) lambdas into REMAINING-match lambdas:
 *   lambda_rem = lambda_base * f(t_rem)  ·  × red-card multipliers  ·  × bounded pressure.
 * Pure. Pressure scalars are pre-decayed in state/ and passed in; here they only apply a
 * bounded multiplier (the flagged on/off heuristic lives behind `pressureEnabled`).
 */

export interface InPlayState {
  readonly minute: number;
  readonly homeReds: number;
  readonly awayReds: number;
  /** Pre-decayed attacking-pressure scalars in [-1,1]; 0 = neutral. */
  readonly homePressure: number;
  readonly awayPressure: number;
}

export interface InPlayConfig {
  readonly regulationMinutes: number;
  readonly redOffendingMult: number;
  readonly redOpponentMult: number;
  readonly pressureEnabled: boolean;
  readonly pressureMaxAbs: number;
}

/** Remaining fraction of regulation time, clamped to [0,1]. */
export function remainingTimeFraction(minute: number, regulationMinutes: number): number {
  const f = (regulationMinutes - minute) / regulationMinutes;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function remainingLambdas(
  base: BaseLambdas,
  state: InPlayState,
  cfg: InPlayConfig,
): { home: number; away: number } {
  const f = remainingTimeFraction(state.minute, cfg.regulationMinutes);
  let home = base.home * f;
  let away = base.away * f;

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
