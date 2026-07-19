import type { RadarClass } from "./radar.js";
import type { Selection } from "./markets.js";

/**
 * Grade sheet (PRD §2, §7). Auto-publishing, fill-independent. CLV grades every quote
 * against the close whether matched or not — the reason an illiquid book degrades the
 * desk gracefully while execution stays a shipped pillar. [LANE: Daniel] presentation.
 */

export interface ClvSample {
  readonly quoteMilliOdds: number;
  readonly closingMilliOdds: number;
  /** Closing-line value in bps of probability: marketProb(close) − quoteProb. */
  readonly clvBps: number;
  readonly matched: boolean;
  readonly radarClass?: RadarClass;
}

export interface ClvDistribution {
  readonly n: number;
  readonly meanClvBps: number;
  readonly medianClvBps: number;
  readonly p25Bps: number;
  readonly p75Bps: number;
  readonly pctPositive: number;
}

/** Brier score with calibration/refinement decomposition (Murphy 1973). */
export interface BrierCalibration {
  readonly brier: number;
  readonly reliability: number; // calibration term (lower better)
  readonly resolution: number; // refinement term (higher better)
  readonly uncertainty: number;
  readonly bins: readonly {
    readonly predictedProb: number;
    readonly observedFreq: number;
    readonly count: number;
  }[];
}

export interface LatencyDistribution {
  readonly market: string;
  readonly n: number;
  readonly p10Ms: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
}

export interface PerClassHitRate {
  readonly signalClass: RadarClass;
  readonly n: number;
  readonly hitRate: number;
  readonly meanClvBps: number;
}

export interface RealizedPnl {
  readonly realizedUnits: number;
  readonly matchedIntents: number;
  readonly settlementTxSigs: readonly string[];
  /** True: all realized PnL below came from the simulated maker book (labeled). */
  readonly simulated: boolean;
}

export interface GradeSheet {
  readonly generatedAtMsgId: string;
  readonly clv: ClvDistribution;
  readonly brier: BrierCalibration;
  readonly latency: readonly LatencyDistribution[];
  readonly perClass: readonly PerClassHitRate[];
  readonly pnl: RealizedPnl;
}

/**
 * One priced quote in fixture order, CLV-graded against the close — the "did this decision
 * beat the market" view a strike-rate/streak scoreboard is built from (win := clvBps > 0).
 */
export interface TimelineSample {
  readonly seq: number;
  readonly msgId: string;
  readonly ts: number;
  readonly marketKey: string;
  readonly selection: Selection;
  readonly side: "BACK" | "LAY";
  readonly quoteMilliOdds: number;
  readonly closingMilliOdds: number;
  readonly clvBps: number;
  readonly win: boolean;
  readonly matched: boolean;
  readonly radarClass?: RadarClass;
}

export interface StreakSummary {
  readonly longestWinStreak: number;
  readonly longestLossStreak: number;
  readonly currentStreak: { readonly kind: "win" | "loss" | "none"; readonly length: number };
}

export interface BacktestTimeline {
  readonly fixtureId: string;
  readonly samples: readonly TimelineSample[];
  /** Running win rate after each sample — samples[i] included — same length as samples. */
  readonly cumulativeWinRate: readonly number[];
  readonly strikeRate: number;
  readonly streaks: StreakSummary;
}
