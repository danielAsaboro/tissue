/**
 * Final-outcome probabilities from a remaining-goals matrix + the current score.
 * "Score enters the matrix directly" (PRD §4): we sum the joint pmf of *remaining* goals
 * over the cells whose (currentHome+rh, currentAway+ra) satisfy each outcome.
 */

export interface OutcomeProbs {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
}

export function outcome1x2(
  matrix: number[][],
  currentHome: number,
  currentAway: number,
): OutcomeProbs {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let rh = 0; rh < matrix.length; rh++) {
    const row = matrix[rh]!;
    for (let ra = 0; ra < row.length; ra++) {
      const p = row[ra]!;
      const fh = currentHome + rh;
      const fa = currentAway + ra;
      if (fh > fa) home += p;
      else if (fh === fa) draw += p;
      else away += p;
    }
  }
  return { home, draw, away };
}

/** P(total match goals over/under a half-integer line), given current score. */
export function outcomeTotals(
  matrix: number[][],
  currentHome: number,
  currentAway: number,
  line: number,
): { over: number; under: number } {
  let over = 0;
  let under = 0;
  const base = currentHome + currentAway;
  for (let rh = 0; rh < matrix.length; rh++) {
    const row = matrix[rh]!;
    for (let ra = 0; ra < row.length; ra++) {
      const p = row[ra]!;
      if (base + rh + ra > line) over += p;
      else under += p;
    }
  }
  return { over, under };
}
