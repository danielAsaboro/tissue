/**
 * TxLINE soccer feed encodings (from resources/tx-on-chain/documentation/scores/soccer-feed.mdx).
 * Kept as named constants so the normalizer never carries magic numbers, and so a future
 * feed-version bump is a one-file change.
 */

/** Base stat keys (participant-scoped), combined with a period prefix. */
export const STAT_KEY = {
  P1_GOALS: 1,
  P2_GOALS: 2,
  P1_YELLOW: 3,
  P2_YELLOW: 4,
  P1_RED: 5,
  P2_RED: 6,
  P1_CORNERS: 7,
  P2_CORNERS: 8,
} as const;

/** Period prefixes added on top of a base key (e.g. 3001 = P1 H2 goals). */
export const PERIOD_PREFIX = {
  TOTAL: 0,
  H1: 1000,
  HT: 2000,
  H2: 3000,
  ET1: 4000,
  ET2: 5000,
  PE: 6000,
  ET_TOTAL: 7000,
} as const;

/** StatusId (game phase) enum. */
export const STATUS = {
  NS: 1,
  H1: 2,
  HT: 3,
  H2: 4,
  F: 5,
  WET: 6,
  ET1: 7,
  HTET: 8,
  ET2: 9,
  FET: 10,
  WPE: 11,
  PE: 12,
  FPE: 13,
  ABANDONED: 15,
  CANCELLED: 16,
  /** game_finalised marker uses statusId=100, period=100 (devnet-examples.mdx). */
  FINALISED: 100,
} as const;

/** Approx nominal minute at the start of each phase, for minute estimation. */
export const PHASE_START_MINUTE: Record<number, number> = {
  [STATUS.NS]: 0,
  [STATUS.H1]: 0,
  [STATUS.HT]: 45,
  [STATUS.H2]: 45,
  [STATUS.ET1]: 90,
  [STATUS.ET2]: 105,
};

/** free_kick.Data.FreeKickType danger levels (NOT possession — see HANDOFF D-004). */
export type FreeKickType = "Safe" | "Attack" | "Danger" | "HighDanger" | "Offside";

/** shot.Data.Outcome values. */
export type ShotOutcome = "OnTarget" | "OffTarget" | "Woodwork" | "Blocked";

export function isFinalStatus(statusId: number): boolean {
  return (
    statusId === STATUS.FINALISED ||
    statusId === STATUS.F ||
    statusId === STATUS.FET ||
    statusId === STATUS.FPE
  );
}
