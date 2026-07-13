import type { ScoreMessage, PressureClass } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import type { TissueState } from "../tissue/price.js";

/**
 * In-play match state machine (PRD §3). Folds ordered score messages into current
 * score/reds/minute plus a bounded, decaying pressure scalar per side. Deterministic:
 * pressure decays by FEED timestamp deltas (data), never a wall-clock read, so replay
 * reproduces the exact same pressure and therefore the exact same prices.
 */

export class MatchState {
  minute = 0;
  homeScore = 0;
  awayScore = 0;
  homeReds = 0;
  awayReds = 0;
  isFinal = false;

  private homePressureRaw = 0;
  private awayPressureRaw = 0;
  private lastTs: number | null = null;

  constructor(private readonly policy: Policy) {}

  private classWeight(c: PressureClass): number {
    const p = this.policy.model.pressure;
    switch (c) {
      case "attack":
        return p.attack_weight;
      case "danger":
        return p.danger_weight;
      case "high_danger":
        return p.high_danger_weight;
      default:
        return 0;
    }
  }

  private decayTo(ts: number): void {
    if (this.lastTs == null) {
      this.lastTs = ts;
      return;
    }
    const dt = Math.max(0, ts - this.lastTs);
    const half = this.policy.model.pressure.decay_half_life_ms;
    const factor = half > 0 ? Math.pow(0.5, dt / half) : 0;
    this.homePressureRaw *= factor;
    this.awayPressureRaw *= factor;
    this.lastTs = ts;
  }

  applyScore(msg: ScoreMessage): void {
    this.decayTo(msg.ts);
    this.minute = msg.minute;
    this.homeScore = msg.homeScore;
    this.awayScore = msg.awayScore;
    this.homeReds = msg.homeReds;
    this.awayReds = msg.awayReds;
    this.isFinal = msg.isFinal;
    this.homePressureRaw += this.classWeight(msg.possession.home);
    this.awayPressureRaw += this.classWeight(msg.possession.away);
  }

  /** Decayed pressure scalars in [0,1] (per side, boosts that side's remaining lambda). */
  pressureScalars(atTs?: number): { home: number; away: number } {
    if (atTs != null) this.decayTo(atTs);
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    return { home: clamp01(this.homePressureRaw), away: clamp01(this.awayPressureRaw) };
  }

  tissueState(atTs?: number): TissueState {
    const p = this.pressureScalars(atTs);
    return {
      minute: this.minute,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      homeReds: this.homeReds,
      awayReds: this.awayReds,
      homePressure: p.home,
      awayPressure: p.away,
    };
  }
}
