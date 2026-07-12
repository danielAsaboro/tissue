import { poissonOverLine, scoreMatrix } from "./poisson.js";
import { outcome1x2 } from "./outcomes.js";

/**
 * Invert a de-vigged pre-match market into base FULL-MATCH scoring intensities
 * (lambdaHome, lambdaAway). These are frozen team-strength rates; the in-play price scales
 * them by remaining time and adjusts for score/reds/pressure (inplay.ts) — the tissue price
 * is therefore INDEPENDENT of the live odds, which is the whole point (PRD §1.1).
 *
 * Deterministic: fixed-iteration bisection (monotone targets), no randomness, no clock.
 */

export interface SolveInputs {
  /** De-vigged pre-match 1X2 probabilities (0..1). */
  readonly home: number;
  readonly draw: number;
  readonly away: number;
  /** Optional de-vigged totals at a line (0..1) to pin total goals. */
  readonly totals?: { line: number; over: number };
}

export interface SolveConfig {
  readonly rho: number;
  readonly maxGoals: number;
  /** Fallback total-goals mean when no totals market is present. */
  readonly defaultTotalGoals: number;
  readonly iterations: number;
}

export interface BaseLambdas {
  readonly home: number;
  readonly away: number;
}

/** Solve total-goals mean mu from an over-probability at a line (monotone increasing). */
function solveMu(line: number, over: number, cfg: SolveConfig): number {
  let lo = 0.1;
  let hi = 8.0;
  for (let i = 0; i < cfg.iterations; i++) {
    const mid = (lo + hi) / 2;
    const o = poissonOverLine(mid, line, cfg.maxGoals);
    if (o < over) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Given total mu, solve home share so DC P(home win) matches the target (monotone). */
function solveHomeShare(mu: number, targetHome: number, cfg: SolveConfig): number {
  let lo = 0.0;
  let hi = 1.0;
  for (let i = 0; i < cfg.iterations; i++) {
    const mid = (lo + hi) / 2;
    const lh = mu * mid;
    const la = mu * (1 - mid);
    const m = scoreMatrix(lh, la, cfg.rho, cfg.maxGoals);
    const p = outcome1x2(m, 0, 0).home;
    if (p < targetHome) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function solveBaseLambdas(inp: SolveInputs, cfg: SolveConfig): BaseLambdas {
  const norm = inp.home + inp.draw + inp.away;
  const home = inp.home / norm;

  const mu = inp.totals
    ? solveMu(inp.totals.line, inp.totals.over, cfg)
    : muFromDrawPrior(inp.draw / norm, cfg);

  const share = solveHomeShare(mu, home, cfg);
  return { home: mu * share, away: mu * (1 - share) };
}

/**
 * Without a totals market, infer total goals from the draw probability: a higher draw
 * probability implies fewer expected goals. Monotone map, solved by bisection so the two
 * 1X2 degrees of freedom (home, away) pin both mu and supremacy.
 */
function muFromDrawPrior(targetDraw: number, cfg: SolveConfig): number {
  let lo = 0.3;
  let hi = 7.0;
  for (let i = 0; i < cfg.iterations; i++) {
    const mid = (lo + hi) / 2;
    // symmetric split maximizes draw prob for a given mu; use it as the reference curve
    const m = scoreMatrix(mid / 2, mid / 2, cfg.rho, cfg.maxGoals);
    const p = outcome1x2(m, 0, 0).draw;
    // draw prob decreases as mu grows → invert the comparison
    if (p > targetDraw) lo = mid;
    else hi = mid;
  }
  const mu = (lo + hi) / 2;
  return Number.isFinite(mu) && mu > 0 ? mu : cfg.defaultTotalGoals;
}
