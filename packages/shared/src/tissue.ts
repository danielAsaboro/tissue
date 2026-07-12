import type { Bps, MilliOdds } from "./units.js";
import type { MarketKey, OddsVector, ProbVector } from "./markets.js";

/**
 * The tissue price: the desk's own fair-value sheet, built from the match itself
 * (score, minute, reds, pressure) — independent of the market (PRD §1.1).
 */

/** Solved scoring intensities for the remainder of the match (goals expected). */
export interface Lambdas {
  /** ×1000 to stay integer-friendly in logs; math uses the float internally then rounds. */
  readonly homeMilli: number;
  readonly awayMilli: number;
}

export interface TissueMarketPrice {
  readonly marketKey: MarketKey;
  readonly fairProb: ProbVector;
  readonly fairOdds: OddsVector;
}

export interface TissuePrice {
  readonly fixtureId: string;
  /** msgId of the score/odds message that drove this reprice (ordering key). */
  readonly triggerMsgId: string;
  readonly minute: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly lambdas: Lambdas;
  /** Whether the flagged pressure modifier was applied to this price. */
  readonly pressureApplied: boolean;
  readonly markets: readonly TissueMarketPrice[];
}

/** Per-selection edge of tissue vs market (de-vigged), the quoting driver. */
export interface Edge {
  readonly marketKey: MarketKey;
  readonly selection: string;
  readonly tissueProb: Bps;
  readonly marketProb: Bps;
  /** tissueProb − marketProb (signed, bps). Positive = tissue thinks selection cheaper. */
  readonly edgeBps: number;
  readonly fairOdds: MilliOdds;
  readonly marketOdds: MilliOdds;
}
