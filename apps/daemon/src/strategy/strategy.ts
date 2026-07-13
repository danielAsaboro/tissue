import {
  type Edge,
  type MarketKey,
  type OddsMessage,
  type ProbVector,
  type RadarClass,
  type Selection,
  type Side,
  bps,
  marketKeyString,
  milliOddsToProb,
  probToMilliOdds,
} from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import type { PricedMarkets } from "../tissue/price.js";
import { reservationQuote } from "./reservation.js";
import { fractionalKellyStake, type KellyConfig } from "./kelly.js";

/**
 * Strategy (PRD §2). Pure. [LANE: Tim]. Turns the tissue price + the live market into
 * two-sided quote proposals: edge = tissue_p − market_p (de-vigged); quote only when
 * |edge| ≥ policy threshold; prices sit around an inventory-shifted reservation; size is
 * capped fractional Kelly; the Radar class conditions spread and can veto (unexplained).
 *
 * These are PROPOSALS. Only the risk module (risk/gates.ts) may green-light them.
 */

export interface QuoteProposal {
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side: Side;
  readonly priceMilliOdds: number;
  readonly sizeUnits: number;
  readonly edgeBps: number;
  readonly radarClass: RadarClass | undefined;
  readonly reason: string;
}

export interface StrategyInputs {
  readonly priced: PricedMarkets;
  readonly market: Map<string, OddsMessage>;
  /** Signed normalized inventory per selection key `${marketKey}:${selection}` in [-1,1]. */
  readonly inventoryNorm: Map<string, number>;
  readonly stalenessMs: number;
  readonly radarClass: RadarClass | undefined;
}

/** Per-selection edge (tissue − market), the quoting driver. */
export function computeEdges(priced: PricedMarkets, market: Map<string, OddsMessage>): Edge[] {
  const edges: Edge[] = [];
  for (const mk of priced.markets) {
    const key = marketKeyString(mk.marketKey);
    const mkt = market.get(key);
    if (!mkt) continue;
    for (const sel of Object.keys(mk.fairProb)) {
      const tissueProb = mk.fairProb[sel]!;
      const marketProb = mkt.consensus[sel];
      if (marketProb === undefined) continue;
      edges.push({
        marketKey: mk.marketKey,
        selection: sel,
        tissueProb,
        marketProb,
        edgeBps: tissueProb - marketProb,
        fairOdds: mk.fairOdds[sel]!,
        marketOdds: probToMilliOdds(marketProb),
      });
    }
  }
  return edges;
}

export function proposeQuotes(inp: StrategyInputs, policy: Policy): QuoteProposal[] {
  // Radar HALT class vetoes all quoting (survival instinct — PRD §1.3).
  if (inp.radarClass && policy.strategy.radar_conditioning.halt_classes.includes(inp.radarClass)) {
    return [];
  }
  if (!policy.markets.in_play_enabled) return [];

  const edges = computeEdges(inp.priced, inp.market);
  const kelly: KellyConfig = {
    kellyFraction: policy.sizing.kelly_fraction,
    bankrollUnits: policy.risk.exposure_cap_per_fixture_units,
    minStakeUnits: policy.sizing.min_stake_units,
    maxStakeUnits: policy.sizing.max_stake_units,
  };

  const proposals: QuoteProposal[] = [];
  for (const e of edges) {
    if (Math.abs(e.edgeBps) < policy.strategy.edge_threshold_bps) continue;

    const selKey = `${marketKeyString(e.marketKey)}:${e.selection}`;
    const q = reservationQuote(
      {
        fairProbBps: e.tissueProb,
        inventoryNorm: inp.inventoryNorm.get(selKey) ?? 0,
        stalenessMs: inp.stalenessMs,
        radarClass: inp.radarClass,
      },
      policy,
    );

    // Value side takes priority; we post both sides (two-sided maker) sized by Kelly.
    const backOdds = probToMilliOdds(bps(q.backProbBps));
    const layOdds = probToMilliOdds(bps(q.layProbBps));
    const pTrue = e.tissueProb / 10000;

    const backStake = fractionalKellyStake(pTrue, backOdds / 1000, kelly);
    if (backStake > 0 && inBand(backOdds, policy)) {
      proposals.push(quote(e, "BACK", backOdds, backStake, inp.radarClass, "back-value"));
    }
    // Laying profits when true prob is BELOW the lay-implied prob; size on (1 − pTrue).
    const layImplied = milliOddsToProb(layOdds) / 10000;
    const layStake = fractionalKellyStake(1 - pTrue, 1 / Math.max(1 - layImplied, 1e-4), kelly);
    if (layStake > 0 && inBand(layOdds, policy)) {
      proposals.push(quote(e, "LAY", layOdds, layStake, inp.radarClass, "lay-spread"));
    }
  }
  return proposals;
}

function quote(
  e: Edge,
  side: Side,
  priceMilliOdds: number,
  sizeUnits: number,
  radarClass: RadarClass | undefined,
  reason: string,
): QuoteProposal {
  return {
    marketKey: e.marketKey,
    selection: e.selection as Selection,
    side,
    priceMilliOdds,
    sizeUnits,
    edgeBps: e.edgeBps,
    radarClass,
    reason,
  };
}

/** A desk does not quote near-certainties or deep longshots (policy odds band). */
function inBand(milliOdds: number, policy: Policy): boolean {
  return (
    milliOdds >= policy.strategy.min_quote_odds_milli &&
    milliOdds <= policy.strategy.max_quote_odds_milli
  );
}

export function marketMapFromOdds(odds: readonly OddsMessage[]): Map<string, OddsMessage> {
  const m = new Map<string, OddsMessage>();
  for (const o of odds) m.set(marketKeyString(o.marketKey), o);
  return m;
}

export type { ProbVector };
