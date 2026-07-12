import type { Bps, MilliOdds } from "./units.js";

export type Network = "devnet" | "mainnet";

/** Markets at launch (PRD §2). Corners/cards switch on via policy as the corpus grows. */
export type MarketId = "1X2" | "TOTALS";

/** 1X2 outcomes and Totals outcomes. Totals carries a line (e.g. 2.5). */
export type Match1x2Selection = "HOME" | "DRAW" | "AWAY";
export type TotalsSelection = "OVER" | "UNDER";
export type Selection = Match1x2Selection | TotalsSelection;

export const MATCH_1X2_SELECTIONS: readonly Match1x2Selection[] = ["HOME", "DRAW", "AWAY"];
export const TOTALS_SELECTIONS: readonly TotalsSelection[] = ["OVER", "UNDER"];

/** A probability distribution over the selections of one market (basis points). */
export type ProbVector = Readonly<Record<string, Bps>>;

/** A fair-odds vector over the selections of one market (milli-odds). */
export type OddsVector = Readonly<Record<string, MilliOdds>>;

/** Totals is parameterized by its goal line. 1X2 has no line. */
export interface MarketKey {
  readonly market: MarketId;
  /** Totals line × 10 (2.5 → 25) to stay integer. Undefined for 1X2. */
  readonly lineTimes10?: number;
}

export function marketKeyString(k: MarketKey): string {
  return k.lineTimes10 == null ? k.market : `${k.market}@${k.lineTimes10 / 10}`;
}
