/**
 * Poisson goal model + Dixon–Coles low-score dependence (Dixon & Coles, 1997,
 * "Modelling Association Football Scores and Inefficiencies in the Football Betting
 * Market", JRSS-C 46(2):265-280). Pure numeric — no I/O, no clock. Internal transcendental
 * math is float; every value the *decision* consumes is rounded to fixed-point downstream
 * (tissue/price.ts), so the ledger and replay stay integer-stable.
 */

/** Poisson pmf vector p(k; lambda) for k in [0, maxGoals], computed iteratively. */
export function poissonPmf(lambda: number, maxGoals: number): number[] {
  const l = Math.max(lambda, 0);
  const out = new Array<number>(maxGoals + 1);
  out[0] = Math.exp(-l);
  for (let k = 1; k <= maxGoals; k++) out[k] = out[k - 1]! * (l / k);
  return out;
}

/**
 * Dixon–Coles tau correction on the four low-score cells (0-0,1-0,0-1,1-1).
 * lambdaH = home rate, lambdaA = away rate, rho = dependence param.
 */
export function dcTau(h: number, a: number, lambdaH: number, lambdaA: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lambdaH * lambdaA * rho;
  if (h === 0 && a === 1) return 1 + lambdaH * rho;
  if (h === 1 && a === 0) return 1 + lambdaA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/**
 * Joint pmf matrix of (home goals, away goals) with DC correction, normalized to sum 1.
 * matrix[h][a] = P(home scores h AND away scores a) over the horizon these lambdas cover.
 */
export function scoreMatrix(
  lambdaH: number,
  lambdaA: number,
  rho: number,
  maxGoals: number,
): number[][] {
  const ph = poissonPmf(lambdaH, maxGoals);
  const pa = poissonPmf(lambdaA, maxGoals);
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row = new Array<number>(maxGoals + 1);
    for (let a = 0; a <= maxGoals; a++) {
      const v = ph[h]! * pa[a]! * dcTau(h, a, lambdaH, lambdaA, rho);
      const clamped = v < 0 ? 0 : v; // tau can push a tiny cell negative at extreme rho
      row[a] = clamped;
      total += clamped;
    }
    m.push(row);
  }
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h++)
      for (let a = 0; a <= maxGoals; a++) m[h]![a]! /= total;
  }
  return m;
}

/** P(total goals from a single Poisson(mu) exceeds a half-integer line). */
export function poissonOverLine(mu: number, line: number, maxGoals: number): number {
  const p = poissonPmf(mu, maxGoals);
  let under = 0;
  const floor = Math.floor(line);
  for (let k = 0; k <= Math.min(floor, maxGoals); k++) under += p[k]!;
  return 1 - under;
}
