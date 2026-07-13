import {
  type ClvSample,
  type GradeSheet,
  type LatencyDistribution,
  type PerClassHitRate,
  type RadarClass,
  RADAR_CLASSES,
} from "@tissue/shared";
import type { EngineResult } from "../replay/engine.js";
import type { Policy } from "../config/policy.js";
import { brierDecomposition, type ForecastOutcome } from "./brier.js";
import { clvBps, summarizeClv } from "./clv.js";

/**
 * Grade sheet assembler (PRD §2, §7). Fill-independent, auto-publishing. Pure over an
 * EngineResult. [LANE: Daniel] owns presentation. Realized PnL is flagged `simulated`
 * because it comes from the simulated maker book (HANDOFF D-001).
 */

export function grade(result: EngineResult, policy: Policy): GradeSheet {
  const clvSamples = buildClvSamples(result);
  const brier = buildBrier(result, policy.grader.brier_calibration_bins);
  const latency = buildLatency(result);
  const perClass = buildPerClass(clvSamples);
  const fills = result.book.allFills();
  const settlement = result.book.settle(result.finalScore.home, result.finalScore.away);

  return {
    generatedAtMsgId: result.ledger.all().at(-1)?.triggerMsgId ?? "",
    clv: summarizeClv(clvSamples),
    brier,
    latency,
    perClass,
    pnl: {
      realizedUnits: settlement.totalPnlUnits,
      matchedIntents: new Set(fills.map((f) => f.tissueIntentId)).size,
      settlementTxSigs: [], // simulated book — no on-chain settlement tx
      simulated: true,
    },
  };
}

function closingProbBps(result: EngineResult, marketKey: string, selection: string): number | null {
  const msg = result.closingMarket.get(marketKey);
  if (!msg) return null;
  const p = msg.consensus[selection];
  return p === undefined ? null : p;
}

function buildClvSamples(result: EngineResult): ClvSample[] {
  const out: ClvSample[] = [];
  for (const q of result.quotes) {
    const closing = closingProbBps(result, q.marketKey, q.selection);
    if (closing === null) continue;
    out.push({
      quoteMilliOdds: q.quoteMilliOdds,
      closingMilliOdds: closing > 0 ? Math.round((10000 / closing) * 1000) : 0,
      clvBps: clvBps(q.side, q.quoteProbBps, closing),
      matched: q.matched,
      ...(q.radarClass ? { radarClass: q.radarClass } : {}),
    });
  }
  return out;
}

function buildBrier(result: EngineResult, bins: number) {
  const homeWon: 0 | 1 = result.finalScore.home > result.finalScore.away ? 1 : 0;
  const pairs: ForecastOutcome[] = result.forecasts.map((f) => ({
    p: f.homeProbBps / 10000,
    outcome: homeWon,
  }));
  return brierDecomposition(pairs, bins);
}

function buildLatency(result: EngineResult): LatencyDistribution[] {
  const byMarket = new Map<string, number[]>();
  for (const e of result.radarEvents) {
    if (e.reactionLatencyMs === undefined) continue;
    const key = e.marketKey.market;
    const arr = byMarket.get(key) ?? [];
    arr.push(e.reactionLatencyMs);
    byMarket.set(key, arr);
  }
  const out: LatencyDistribution[] = [];
  for (const [market, samples] of byMarket) {
    const sorted = [...samples].sort((a, b) => a - b);
    out.push({
      market,
      n: sorted.length,
      p10Ms: pct(sorted, 10),
      p50Ms: pct(sorted, 50),
      p90Ms: pct(sorted, 90),
    });
  }
  return out;
}

function buildPerClass(samples: readonly ClvSample[]): PerClassHitRate[] {
  const out: PerClassHitRate[] = [];
  for (const cls of RADAR_CLASSES) {
    const forClass = samples.filter((s) => s.radarClass === cls);
    if (forClass.length === 0) continue;
    const hits = forClass.filter((s) => s.clvBps > 0).length;
    const meanClv = forClass.reduce((s, x) => s + x.clvBps, 0) / forClass.length;
    out.push({
      signalClass: cls as RadarClass,
      n: forClass.length,
      hitRate: hits / forClass.length,
      meanClvBps: Math.round(meanClv),
    });
  }
  return out;
}

function pct(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)]!;
}
