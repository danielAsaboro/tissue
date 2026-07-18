import type { FeedMessage, GradeSheet, Network } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { grade } from "../grader/grader.js";
import { type EngineOptions, type EngineResult, runEngine } from "../replay/engine.js";
import { baselinePolicy } from "./baselinePolicy.js";

/**
 * Runs the SAME ordered feed through the SAME deterministic engine twice — once with the
 * full policy (every regime enabled), once with baselinePolicy(policy) (every flagged
 * heuristic/regime neutralized) — and grades both with the SAME grader. Both hash-chain
 * independently; replay(corpus) === ledger holds for each side separately.
 */
export interface ArenaResult {
  readonly tissue: EngineResult;
  readonly baseline: EngineResult;
  readonly tissueGrade: GradeSheet;
  readonly baselineGrade: GradeSheet;
}

export function runArena(
  corpus: readonly FeedMessage[],
  policy: Policy,
  network: Network = "devnet",
  opts: EngineOptions = {},
): ArenaResult {
  const basePolicy = baselinePolicy(policy);
  const tissue = runEngine(corpus, policy, network, opts);
  const baseline = runEngine(corpus, basePolicy, network, opts);
  return {
    tissue,
    baseline,
    tissueGrade: grade(tissue, policy),
    baselineGrade: grade(baseline, basePolicy),
  };
}

/** Compact head-to-head summary for CLI/API surfaces — the numbers that decide the arena. */
export interface ArenaSummary {
  readonly fixtureId: string;
  readonly tissue: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  readonly baseline: { readonly meanClvBps: number; readonly clvN: number; readonly brier: number };
  /** Positive means Tissue's regimes edge out the neutralized baseline on this fixture. */
  readonly clvEdgeBps: number;
  readonly brierEdge: number;
}

export function summarizeArena(result: ArenaResult): ArenaSummary {
  return {
    fixtureId: result.tissue.fixtureId,
    tissue: {
      meanClvBps: result.tissueGrade.clv.meanClvBps,
      clvN: result.tissueGrade.clv.n,
      brier: result.tissueGrade.brier.brier,
    },
    baseline: {
      meanClvBps: result.baselineGrade.clv.meanClvBps,
      clvN: result.baselineGrade.clv.n,
      brier: result.baselineGrade.brier.brier,
    },
    clvEdgeBps: result.tissueGrade.clv.meanClvBps - result.baselineGrade.clv.meanClvBps,
    // Brier is a LOSS (lower is better) — a negative edge means Tissue's Brier is lower (better).
    brierEdge: result.tissueGrade.brier.brier - result.baselineGrade.brier.brier,
  };
}
