import {
  type FeedMessage,
  type HaltSignal,
  type MarketKey,
  type OddsMessage,
  type RadarEvent,
  type RadarTriggerEvent,
  type ScoreMessage,
  bps,
  marketKeyString,
  millis,
} from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { type LatencyBand, computeBand } from "./percentiles.js";
import { type ClassifyConfig, type ReactionSummary, classifyReaction } from "./classify.js";
import { type InformedFlowConfig, isInformedFlowVelocity, moveVelocityBpsPerSec } from "./informedFlow.js";

/**
 * Latency Radar engine (PRD §1.2). Consumes the ordered feed, keys market reactions to
 * match events, and emits a RadarEvent per reaction plus a HaltSignal on unexplained
 * movement. Deterministic: driven by feed `ts` (data) and message order, never wall-clock.
 *
 * [LANE: Daniel] — this is a working first pass. Threshold calibration (T5), the signal
 * taxonomy, and stabilization detection are his to refine/redesign. Everything tunable is
 * already in `policy.toml [radar]`.
 */

interface ReactionCtx {
  readonly event: RadarTriggerEvent;
  readonly eventTs: number;
  readonly minuteAtEvent: number;
  readonly baseline: Record<string, number>;
  firstReactionTs: number | undefined;
  peakMagnitudeBps: number;
  peakProbs: Record<string, number>;
  lastProbs: Record<string, number>;
}

interface MarketState {
  baseline: Record<string, number> | null;
  latest: Record<string, number> | null;
  reaction: ReactionCtx | null;
  /** For the informed-flow velocity check (informedFlow.ts): last odds ts + this market's
   *  own trailing velocity distribution (bps/sec, bounded window). */
  lastOddsTs: number | null;
  velocitySamples: number[];
}

export interface RadarOutput {
  readonly events: RadarEvent[];
  readonly halts: HaltSignal[];
}

export class Radar {
  private readonly markets = new Map<string, MarketState>();
  private readonly latencySamples = new Map<string, number[]>();
  private lastScore: ScoreMessage | null = null;
  private readonly out: RadarOutput = { events: [], halts: [] };

  private readonly cfg: ClassifyConfig;
  private readonly informedFlowCfg: InformedFlowConfig;
  constructor(private readonly policy: Policy) {
    this.cfg = {
      significantBps: policy.radar.significant_reaction_bps,
      overreactionRetracePct: policy.radar.overreaction_retrace_pct,
      drawWatchAfterMinute: policy.radar.draw_compression.watch_after_minute,
      drawCompressionBps: policy.radar.draw_compression.compression_bps,
      favoritePanicBps: policy.radar.significant_reaction_bps * 2,
    };
    this.informedFlowCfg = {
      toxicPercentile: policy.radar.informed_flow.toxic_percentile,
      minSamples: policy.radar.informed_flow.min_samples,
      seedVelocityBpsPerSec: policy.radar.informed_flow.seed_velocity_bps_per_sec,
    };
  }

  /** Feed one ordered message; returns any new events/halts produced by it. */
  observe(msg: FeedMessage): RadarOutput {
    const before = { e: this.out.events.length, h: this.out.halts.length };
    if (msg.kind === "score") this.onScore(msg);
    else this.onOdds(msg);
    return {
      events: this.out.events.slice(before.e),
      halts: this.out.halts.slice(before.h),
    };
  }

  /** Finalize any reaction whose window has closed (call at end of a corpus run). */
  flush(atTs: number): RadarOutput {
    const before = { e: this.out.events.length, h: this.out.halts.length };
    for (const [key, st] of this.markets) if (st.reaction) this.finalize(key, st, atTs);
    return { events: this.out.events.slice(before.e), halts: this.out.halts.slice(before.h) };
  }

  get all(): RadarOutput {
    return this.out;
  }

  private state(key: string): MarketState {
    let st = this.markets.get(key);
    if (!st) {
      st = { baseline: null, latest: null, reaction: null, lastOddsTs: null, velocitySamples: [] };
      this.markets.set(key, st);
    }
    return st;
  }

  private onScore(msg: ScoreMessage): void {
    const ev = this.detectEvent(msg);
    this.lastScore = msg;
    if (ev.kind === "none") return;
    // Open a reaction context on every market we already have a baseline for.
    for (const [, st] of this.markets) {
      if (!st.latest) continue;
      st.baseline = { ...st.latest };
      st.reaction = {
        event: ev,
        eventTs: msg.ts,
        minuteAtEvent: msg.minute,
        baseline: { ...st.latest },
        firstReactionTs: undefined,
        peakMagnitudeBps: 0,
        peakProbs: { ...st.latest },
        lastProbs: { ...st.latest },
      };
    }
  }

  private detectEvent(msg: ScoreMessage): RadarTriggerEvent {
    const prev = this.lastScore;
    const base = { msgId: msg.msgId, ts: msg.ts, minute: msg.minute };
    if (!prev) return { kind: "none", ...base };
    if (msg.homeScore > prev.homeScore || msg.awayScore > prev.awayScore)
      return { kind: "goal", ...base };
    // A score DECREASE is a VAR/correction reversal — a real, explaining event. Without this
    // the market's snap-back would be misread as unexplained-movement and falsely HALT.
    if (msg.homeScore < prev.homeScore || msg.awayScore < prev.awayScore)
      return { kind: "score_correction", ...base };
    if (msg.homeReds > prev.homeReds || msg.awayReds > prev.awayReds)
      return { kind: "red_card", ...base };
    return { kind: "none", ...base };
  }

  private onOdds(msg: OddsMessage): void {
    const key = marketKeyString(msg.marketKey);
    const st = this.state(key);
    const probs = toNumberMap(msg.consensus);
    const previousProbs = st.latest;
    const previousTs = st.lastOddsTs;
    st.latest = probs;
    st.lastOddsTs = msg.ts;
    if (!st.baseline) {
      st.baseline = { ...probs };
      return;
    }

    if (st.reaction) {
      const r = st.reaction;
      const withinWindow = msg.ts - r.eventTs <= this.policy.radar.unexplained_window_ms;
      if (withinWindow) {
        const magVsEvent = magnitude(r.baseline, probs);
        if (r.firstReactionTs === undefined && magVsEvent >= this.cfg.significantBps) {
          r.firstReactionTs = msg.ts;
        }
        if (magVsEvent > r.peakMagnitudeBps) {
          r.peakMagnitudeBps = magVsEvent;
          r.peakProbs = { ...probs };
        }
        r.lastProbs = { ...probs };
        return;
      }
      // Window closed: finalize the reaction (this resets st.baseline to its last level),
      // then evaluate THIS message against the fresh baseline below.
      this.finalize(key, st, msg.ts);
    }

    // Measure against the current baseline (post-finalize if a reaction just closed).
    const magVsBaseline = magnitude(st.baseline, probs);

    // Consensus-based informed-flow (informedFlow.ts): this market's own move VELOCITY
    // against its own recent distribution — self-calibrating per market/regime, so it can
    // catch a sudden move BEFORE the fixed unexplained_bps magnitude threshold below would,
    // on a market whose typical volatility is lower than the fleet-wide fixed threshold.
    if (this.policy.radar.informed_flow.enabled && previousProbs && previousTs !== null) {
      const stepMagBps = magnitude(previousProbs, probs);
      const velocity = moveVelocityBpsPerSec(stepMagBps, msg.ts - previousTs);
      const toxic = isInformedFlowVelocity(velocity, st.velocitySamples, this.informedFlowCfg);
      st.velocitySamples.push(velocity);
      if (st.velocitySamples.length > 200) st.velocitySamples.shift(); // bounded trailing window
      if (toxic) {
        this.emitInformedFlow(msg, key, velocity, magVsBaseline);
        st.baseline = { ...probs };
        return;
      }
    }

    // No open reaction: a LARGE move with no recent event is unexplained (adverse
    // selection). Uses a higher threshold than reaction-significance so ordinary drift
    // does not trip the survival instinct.
    if (magVsBaseline >= this.policy.radar.unexplained_bps) {
      this.emitUnexplained(msg, key, magVsBaseline);
      st.baseline = { ...probs };
    } else if (magVsBaseline >= this.cfg.significantBps) {
      // Meaningful but explained-enough drift: advance the baseline without halting.
      st.baseline = { ...probs };
    }
  }

  private finalize(key: string, st: MarketState, atTs: number): void {
    const r = st.reaction;
    if (!r) return;
    st.reaction = null;

    const finalMag = magnitude(r.baseline, r.lastProbs);
    const peakMove = r.peakMagnitudeBps;
    const retraceFraction =
      peakMove > 0 ? Math.max(0, Math.min(1, (peakMove - finalMag) / peakMove)) : 0;

    const summary: ReactionSummary = {
      marketKey: parseKey(key),
      triggerEvent: r.event,
      hadEvent: true,
      minuteAtEvent: r.minuteAtEvent,
      firstReactionTs: r.firstReactionTs,
      reactionLatencyMs: r.firstReactionTs === undefined ? undefined : r.firstReactionTs - r.eventTs,
      peakMagnitudeBps: peakMove,
      finalMagnitudeBps: finalMag,
      retraceFraction,
      favoriteDropBps: favoriteDrop(r.baseline, r.lastProbs),
      drawRiseBps: (r.lastProbs["DRAW"] ?? 0) - (r.baseline["DRAW"] ?? 0),
    };

    const samples = this.samplesFor(key);
    const band = this.bandFor(key, samples);
    const cls = classifyReaction(summary, band, this.cfg, samples);
    if (summary.reactionLatencyMs !== undefined) samples.push(summary.reactionLatencyMs);

    this.out.events.push({
      marketKey: summary.marketKey,
      triggerEvent: r.event,
      eventTs: millis(r.eventTs),
      ...(r.firstReactionTs !== undefined ? { firstReactionTs: millis(r.firstReactionTs) } : {}),
      stabilizationTs: millis(atTs),
      magnitudeBps: bps(Math.round(peakMove)),
      ...(summary.reactionLatencyMs !== undefined ? { reactionLatencyMs: summary.reactionLatencyMs } : {}),
      signalClass: cls.signalClass,
      ...(cls.latencyPercentile !== undefined ? { latencyPercentile: cls.latencyPercentile } : {}),
    });

    st.baseline = { ...r.lastProbs };

    if (cls.signalClass === "unexplained-movement") {
      this.out.halts.push({
        reason: "unexplained-movement",
        marketKey: summary.marketKey,
        triggerMsgId: r.event.msgId,
        ts: millis(atTs),
        detail: `unexplained ${Math.round(peakMove)}bps move on ${key}`,
      });
    }
  }

  private emitUnexplained(msg: OddsMessage, key: string, magBps: number): void {
    this.out.events.push({
      marketKey: msg.marketKey,
      triggerEvent: { kind: "none", msgId: msg.msgId, ts: msg.ts, minute: this.lastScore?.minute ?? 0 },
      eventTs: msg.ts,
      magnitudeBps: bps(Math.round(magBps)),
      signalClass: "unexplained-movement",
    });
    this.out.halts.push({
      reason: "unexplained-movement",
      marketKey: msg.marketKey,
      triggerMsgId: msg.msgId,
      ts: msg.ts,
      detail: `unexplained ${Math.round(magBps)}bps move on ${key} with no event in ${this.policy.radar.unexplained_window_ms}ms`,
    });
  }

  private emitInformedFlow(msg: OddsMessage, key: string, velocityBpsPerSec: number, magBps: number): void {
    this.out.events.push({
      marketKey: msg.marketKey,
      triggerEvent: { kind: "none", msgId: msg.msgId, ts: msg.ts, minute: this.lastScore?.minute ?? 0 },
      eventTs: msg.ts,
      magnitudeBps: bps(Math.round(magBps)),
      signalClass: "informed-flow",
    });
    this.out.halts.push({
      reason: "informed-flow",
      marketKey: msg.marketKey,
      triggerMsgId: msg.msgId,
      ts: msg.ts,
      detail: `anomalous move velocity ${velocityBpsPerSec.toFixed(1)}bps/sec on ${key} vs its own trailing distribution`,
    });
  }

  private samplesFor(key: string): number[] {
    let s = this.latencySamples.get(key);
    if (!s) {
      s = [];
      this.latencySamples.set(key, s);
    }
    return s;
  }

  private bandFor(key: string, samples: readonly number[]): LatencyBand {
    const mk = parseKey(key);
    const seedCfg = this.policy.radar.latency_bands_ms[mk.market] ?? {
      fast_p: 20,
      slow_p: 80,
      fast_ms: 1500,
      slow_ms: 9000,
    };
    const seed: LatencyBand = { fastMs: seedCfg.fast_ms, slowMs: seedCfg.slow_ms };
    return computeBand(samples, seedCfg.fast_p, seedCfg.slow_p, seed);
  }
}

function toNumberMap(v: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(v)) out[k] = v[k]!;
  return out;
}

function magnitude(a: Record<string, number>, b: Record<string, number>): number {
  let max = 0;
  for (const k of Object.keys(b)) {
    const d = Math.abs((b[k] ?? 0) - (a[k] ?? 0));
    if (d > max) max = d;
  }
  return max;
}

/** Adverse drop of the pre-event favorite among HOME/AWAY (bps), else 0. */
function favoriteDrop(baseline: Record<string, number>, latest: Record<string, number>): number {
  const h = baseline["HOME"];
  const a = baseline["AWAY"];
  if (h === undefined || a === undefined) return 0;
  const favKey = h >= a ? "HOME" : "AWAY";
  const drop = (baseline[favKey] ?? 0) - (latest[favKey] ?? 0);
  return Math.max(0, drop);
}

function parseKey(key: string): MarketKey {
  if (key.startsWith("TOTALS@")) {
    const line = parseFloat(key.slice("TOTALS@".length));
    return { market: "TOTALS", lineTimes10: Math.round(line * 10) };
  }
  return { market: "1X2" };
}
