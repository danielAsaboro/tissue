import {
  type Edge,
  type ExposureSnapshot,
  type HaltSignal,
  type MarketKey,
  marketKeyString,
} from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import type { QuoteProposal } from "../strategy/strategy.js";

/**
 * Risk gate (PRD §5). [LANE: Tim]. THE ONLY MODULE AUTHORIZED TO GREEN-LIGHT EXECUTION.
 * Pure given its inputs. Enforces, in priority order:
 *   1. drawdown kill — global, latched, operator-restart-only (never auto-resumes)
 *   2. stale-feed halt — hard feed gap ⇒ cancel all, SAFE
 *   3. unexplained-movement / informed-flow halt — pull quotes on the affected market
 *      (adverse selection: no explaining event, or an anomalous move velocity)
 *   4. model-divergence sanity band — tissue vs market beyond band ⇒ pull + flag
 *   5. exposure caps (per market / per fixture) + max open intents
 */

export type HaltScope = "ALL" | "MARKET";

export interface HaltAction {
  readonly scope: HaltScope;
  readonly reason: string;
  readonly marketKey?: MarketKey;
  readonly detail: string;
}

export interface RiskContext {
  readonly feedGapMs: number;
  readonly radarHalts: readonly HaltSignal[];
  readonly edges: readonly Edge[];
  readonly exposure: ExposureSnapshot;
  /** True once a drawdown kill has latched; only an operator restart clears it. */
  readonly killed: boolean;
}

export interface RiskDecision {
  readonly killed: boolean;
  readonly halts: HaltAction[];
  readonly approved: QuoteProposal[];
  readonly rejected: { proposal: QuoteProposal; reason: string }[];
  readonly flags: string[];
}

export function evaluateRisk(
  proposals: readonly QuoteProposal[],
  ctx: RiskContext,
  policy: Policy,
): RiskDecision {
  const halts: HaltAction[] = [];
  const flags: string[] = [];
  const rejected: { proposal: QuoteProposal; reason: string }[] = [];

  // 1. Drawdown kill — highest priority, latched.
  const killed = ctx.killed || ctx.exposure.drawdownUnits >= policy.risk.drawdown_kill_units;
  if (killed) {
    halts.push({ scope: "ALL", reason: "drawdown-kill", detail: `drawdown ${ctx.exposure.drawdownUnits} ≥ kill ${policy.risk.drawdown_kill_units} (operator restart only)` });
    return { killed: true, halts, approved: [], rejected: proposals.map((p) => ({ proposal: p, reason: "drawdown-kill" })), flags };
  }

  // 2. Stale-feed hard halt.
  if (ctx.feedGapMs >= policy.feed.max_gap_ms) {
    halts.push({ scope: "ALL", reason: "feed-gap", detail: `feed gap ${ctx.feedGapMs}ms ≥ ${policy.feed.max_gap_ms}ms — cancel all, SAFE` });
    return { killed: false, halts, approved: [], rejected: proposals.map((p) => ({ proposal: p, reason: "feed-gap" })), flags };
  }

  // 3. Unexplained-movement / informed-flow halts (per market, same adverse-selection gate).
  const haltedMarkets = new Set<string>();
  for (const h of ctx.radarHalts) {
    if ((h.reason !== "unexplained-movement" && h.reason !== "informed-flow") || !h.marketKey) continue;
    const key = marketKeyString(h.marketKey);
    haltedMarkets.add(key);
    halts.push({ scope: "MARKET", reason: h.reason, marketKey: h.marketKey, detail: h.detail });
  }

  // 4. Model-divergence sanity band (per market): protect against our own model failure.
  for (const e of ctx.edges) {
    if (Math.abs(e.edgeBps) > policy.risk.model_divergence_band_bps) {
      const key = marketKeyString(e.marketKey);
      if (!haltedMarkets.has(key)) {
        haltedMarkets.add(key);
        halts.push({ scope: "MARKET", reason: "model-divergence", marketKey: e.marketKey, detail: `|edge| ${Math.abs(e.edgeBps)}bps > band ${policy.risk.model_divergence_band_bps}bps — pull + flag` });
        flags.push(`model-divergence on ${key}`);
      }
    }
  }

  // 5. Exposure caps + max open intents (greedy, cumulative).
  const projMarket: Record<string, number> = { ...ctx.exposure.perMarketUnits };
  let projFixture = ctx.exposure.perFixtureUnits;
  let openCount = ctx.exposure.openIntents;
  const approved: QuoteProposal[] = [];

  for (const p of proposals) {
    const key = marketKeyString(p.marketKey);
    if (haltedMarkets.has(key)) {
      rejected.push({ proposal: p, reason: "market-halted" });
      continue;
    }
    if (openCount + 1 > policy.risk.max_open_intents) {
      rejected.push({ proposal: p, reason: "max-open-intents" });
      continue;
    }
    const nextMarket = (projMarket[key] ?? 0) + p.sizeUnits;
    if (nextMarket > policy.risk.exposure_cap_per_market_units) {
      rejected.push({ proposal: p, reason: "market-exposure-cap" });
      continue;
    }
    if (projFixture + p.sizeUnits > policy.risk.exposure_cap_per_fixture_units) {
      rejected.push({ proposal: p, reason: "fixture-exposure-cap" });
      continue;
    }
    projMarket[key] = nextMarket;
    projFixture += p.sizeUnits;
    openCount += 1;
    approved.push(p);
  }

  return { killed: false, halts, approved, rejected, flags };
}
