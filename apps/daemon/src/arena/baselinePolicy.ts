import type { Policy } from "../config/policy.js";

/**
 * Strategy Arena (PRD extension, mapped from the sponsor's "Agent vs Agent Arena" idea).
 * Two agents read the SAME live feed and run through the SAME deterministic engine,
 * ledger, and grader (replay/engine.ts, grader/grader.ts) — only the policy differs. This is
 * the honest way to build the arena without inventing a second, unvalidated pricing model:
 * "Tissue" is the full desk with every heuristic regime enabled; "Baseline" is the identical
 * Dixon-Coles pricing core with every flagged heuristic/regime NEUTRALIZED back to a no-op.
 * The comparison answers a real question with real CLV/Brier — does turning these on
 * actually help? — rather than asserting it.
 *
 * "Neutralized" means: the multiplier that regime would apply becomes 1 (no-op), or the
 * heuristic's enabled flag turns off. It does NOT touch the correctness fixes bundled into
 * the same code paths (e.g. the stoppage-time floor that stops lambda from hard-zeroing at
 * minute 90 stays on for both agents — that is a bug fix, not an opinion, so ablating it
 * would make Baseline wrong on purpose rather than merely "simpler").
 */
export function baselinePolicy(policy: Policy): Policy {
  const cloned = structuredClone(policy);
  return {
    ...cloned,
    model: {
      ...cloned.model,
      pressure: { ...cloned.model.pressure, enabled: false },
      stoppage: { ...cloned.model.stoppage, lambda_mult: 1 },
      // min_duration_ms effectively infinite ⇒ the sustained-window latch can never fully
      // elapse, so the regime never activates (truer neutralization than an edge-case
      // threshold value, which pressure could theoretically still reach).
      mutual_danger: { ...cloned.model.mutual_danger, min_duration_ms: Number.MAX_SAFE_INTEGER },
    },
    strategy: {
      ...cloned.strategy,
      stoppage_spread_mult: 1,
      mutual_danger_spread_mult: 1,
      mutual_danger_size_mult: 1,
      narrative_conditioning: {
        compounding_size_mult: 1,
        cautious_spread_mult: 1,
        cautious_size_mult: 1,
        oscillating_size_mult: 1,
      },
      stale_quote: { ...cloned.strategy.stale_quote, min_spread_mult: 1 },
    },
    radar: {
      ...cloned.radar,
      informed_flow: { ...cloned.radar.informed_flow, enabled: false },
    },
  };
}
