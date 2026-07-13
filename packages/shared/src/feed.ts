import type { Bps, MilliOdds, Millis } from "./units.js";
import type { MarketKey, Network, ProbVector } from "./markets.js";

/**
 * Normalized feed messages. These are what `ingest/` produces from the raw TxLINE
 * SSE payloads; the rest of the daemon only ever sees these shapes.
 */

export type FeedKind = "score" | "odds";

export interface FeedEnvelope {
  /** Feed message id — the canonical ordering + dedupe key. */
  readonly msgId: string;
  readonly kind: FeedKind;
  readonly fixtureId: string;
  /** Feed-reported timestamp (ms). Measurement only — never a pure-core decision input. */
  readonly ts: Millis;
  readonly network: Network;
}

/** Possession pressure states from the scores stream (Attack / Danger / HighDanger). */
export interface PossessionState {
  readonly home: PressureClass;
  readonly away: PressureClass;
}
export type PressureClass = "none" | "attack" | "danger" | "high_danger";

/** In-play match state derived from the scores stream. */
export interface ScoreMessage extends FeedEnvelope {
  readonly kind: "score";
  /** TxLINE fixture sequence used to retrieve the exact publisher-anchored stat proof. */
  readonly sourceSeq?: number;
  readonly minute: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeReds: number;
  readonly awayReds: number;
  readonly possession: PossessionState;
  /** Period / game phase label as reported by the feed, if any. */
  readonly phase?: string;
  readonly isFinal: boolean;
  /** Abandoned/cancelled: the match did not complete → positions VOID, never settle on score. */
  readonly isVoid: boolean;
}

/** A de-margined consensus odds update from the odds stream. */
export interface OddsMessage extends FeedEnvelope {
  readonly kind: "odds";
  readonly marketKey: MarketKey;
  /** De-vigged consensus probabilities per selection (bps). See GROUND-TRUTH.md T2. */
  readonly consensus: ProbVector;
  /** Raw decimal odds per selection (milli-odds), pre-de-vig, when available. */
  readonly rawOdds?: Readonly<Record<string, MilliOdds>>;
  readonly inRunning: boolean;
  /** Bookmaker granularity if the stream carries it (T2). Consensus-only otherwise. */
  readonly bookmaker?: string;
  readonly bookmakerId?: number;
}

export type FeedMessage = ScoreMessage | OddsMessage;

export interface FeedHealth {
  readonly network: Network;
  readonly lastMsgTs: Millis;
  readonly gapMs: number;
  readonly stale: boolean;
  readonly halted: boolean;
}

/** Measured feed lag sample (for the published latency histogram, PR judging). */
export interface FeedLagSample {
  readonly network: Network;
  readonly kind: FeedKind;
  readonly lagMs: number;
  readonly reactionBps?: Bps;
  readonly reactionMilliOdds?: MilliOdds;
}
