import type { ClvDistribution, ClvSample } from "@tissue/shared";

/**
 * Closing-line value (PRD §7). CLV grades every quote against the closing line WHETHER
 * MATCHED OR NOT — this fill-independence is why an illiquid book degrades the desk
 * gracefully while execution stays a shipped pillar (PRD §1.4). Deterministic.
 *
 * clvBps is signed in the desk's favor:
 *   BACK: closingProb − quoteProb  (we bought below where the line closed ⇒ +)
 *   LAY:  quoteProb − closingProb  (we sold above where the line closed ⇒ +)
 */

export function clvBps(side: "BACK" | "LAY", quoteProbBps: number, closingProbBps: number): number {
  return side === "BACK" ? closingProbBps - quoteProbBps : quoteProbBps - closingProbBps;
}

export function summarizeClv(samples: readonly ClvSample[]): ClvDistribution {
  const n = samples.length;
  if (n === 0) {
    return { n: 0, meanClvBps: 0, medianClvBps: 0, p25Bps: 0, p75Bps: 0, pctPositive: 0 };
  }
  const vals = samples.map((s) => s.clvBps).sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const positive = vals.filter((v) => v > 0).length;
  return {
    n,
    meanClvBps: Math.round(mean),
    medianClvBps: q(vals, 50),
    p25Bps: q(vals, 25),
    p75Bps: q(vals, 75),
    pctPositive: positive / n,
  };
}

function q(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)]!;
}
