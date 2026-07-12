import type { Policy } from "../config/policy.js";
import { type BaseLambdas, type SolveConfig, type SolveInputs, solveBaseLambdas } from "./solve.js";
import { type TissueState, type PricedMarkets, priceMarkets } from "./price.js";

export * from "./poisson.js";
export * from "./outcomes.js";
export * from "./solve.js";
export * from "./inplay.js";
export * from "./price.js";

export function solveConfigFromPolicy(policy: Policy): SolveConfig {
  return {
    rho: policy.model.dc_rho,
    maxGoals: policy.model.max_goals_per_side,
    defaultTotalGoals: 2.6,
    iterations: 44,
  };
}

/**
 * Convenience wrapper: solve base lambdas once from the opening de-vigged line, then price
 * any in-play state against them. This is what state/ holds per fixture.
 */
export class TissuePricer {
  readonly base: BaseLambdas;
  constructor(opening: SolveInputs, private readonly policy: Policy) {
    this.base = solveBaseLambdas(opening, solveConfigFromPolicy(policy));
  }
  price(state: TissueState): PricedMarkets {
    return priceMarkets(this.base, state, this.policy);
  }
}
