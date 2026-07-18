import type { FeedMessage, GradeSheet, Network } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { grade } from "../grader/grader.js";
import { type EngineOptions, runEngine } from "../replay/engine.js";
import { baselinePolicy } from "./baselinePolicy.js";

/**
 * N-way regime ablation. runArena (arena.ts) answers "do the regimes help, as a bundle?" —
 * useful, but it can't tell you which one is pulling its weight and which is dead code that
 * happens not to hurt. This isolates each flagged regime one at a time (baseline + exactly
 * that regime turned back on) and grades it against the SAME neutralized baseline, so each
 * regime's contribution is a real, separately-measured number instead of a bundled guess.
 */

export const REGIME_NAMES = [
  "stoppage",
  "mutual_danger",
  "narrative",
  "informed_flow",
  "stale_quote",
] as const;

export type RegimeName = (typeof REGIME_NAMES)[number];

/** Starts from the fully-neutralized baseline and re-enables exactly one regime's fields
 *  from the real policy — every other flagged heuristic stays neutralized. */
export function regimeOnlyPolicy(policy: Policy, regime: RegimeName): Policy {
  const base = baselinePolicy(policy);
  switch (regime) {
    case "stoppage":
      return {
        ...base,
        model: { ...base.model, stoppage: { ...policy.model.stoppage } },
        strategy: { ...base.strategy, stoppage_spread_mult: policy.strategy.stoppage_spread_mult },
      };
    case "mutual_danger":
      return {
        ...base,
        model: { ...base.model, mutual_danger: { ...policy.model.mutual_danger } },
        strategy: {
          ...base.strategy,
          mutual_danger_spread_mult: policy.strategy.mutual_danger_spread_mult,
          mutual_danger_size_mult: policy.strategy.mutual_danger_size_mult,
        },
      };
    case "narrative":
      return {
        ...base,
        strategy: { ...base.strategy, narrative_conditioning: { ...policy.strategy.narrative_conditioning } },
      };
    case "informed_flow":
      return {
        ...base,
        radar: { ...base.radar, informed_flow: { ...policy.radar.informed_flow } },
      };
    case "stale_quote":
      return {
        ...base,
        strategy: { ...base.strategy, stale_quote: { ...policy.strategy.stale_quote } },
      };
  }
}

export interface RegimeAblationRow {
  readonly regime: RegimeName;
  readonly meanClvBps: number;
  readonly clvN: number;
  readonly brier: number;
  /** Positive means this regime alone edges out the fully-neutralized baseline on CLV. */
  readonly clvEdgeBps: number;
  /** Brier is a loss (lower is better) — negative means this regime alone lowers Brier. */
  readonly brierEdge: number;
}

export interface AblationMatrix {
  readonly fixtureId: string;
  readonly baseline: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  readonly rows: readonly RegimeAblationRow[];
}

export function runAblationMatrix(
  corpus: readonly FeedMessage[],
  policy: Policy,
  network: Network = "devnet",
  opts: EngineOptions = {},
): AblationMatrix {
  const basePolicy = baselinePolicy(policy);
  const baselineResult = runEngine(corpus, basePolicy, network, opts);
  const baselineSheet: GradeSheet = grade(baselineResult, basePolicy);
  const rows = REGIME_NAMES.map((regime) => {
    const regimePolicy = regimeOnlyPolicy(policy, regime);
    const result = runEngine(corpus, regimePolicy, network, opts);
    const sheet = grade(result, regimePolicy);
    return {
      regime,
      meanClvBps: sheet.clv.meanClvBps,
      clvN: sheet.clv.n,
      brier: sheet.brier.brier,
      clvEdgeBps: sheet.clv.meanClvBps - baselineSheet.clv.meanClvBps,
      brierEdge: sheet.brier.brier - baselineSheet.brier.brier,
    };
  });
  return {
    fixtureId: baselineResult.fixtureId,
    baseline: { meanClvBps: baselineSheet.clv.meanClvBps, clvN: baselineSheet.clv.n, brier: baselineSheet.brier.brier },
    rows,
  };
}
