import type { ScoreMessage, PressureClass } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import type { TissueState } from "../tissue/price.js";
import type { MatchPhase } from "../tissue/inplay.js";
import { isExtraTimePhase, isPenaltiesPhase, isStoppageTime } from "../ingest/soccerFeed.js";

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
  private statusId = 0;

  private homePressureRaw = 0;
  private awayPressureRaw = 0;
  private lastTs: number | null = null;
  /** ts at which both sides first sustained the mutual-danger pressure threshold; null when
   *  not currently in that condition (state/matchState.ts, model.mutual_danger). */
  private mutualDangerSinceTs: number | null = null;

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
    // `game_finalised` is commonly followed by a `disconnected` delivery with no status or
    // clock. Terminal state is monotonic: transport teardown must not reopen a completed
    // match or reset its model clock to zero.
    if (this.isFinal && !msg.isFinal) return;
    this.minute = msg.isFinal ? Math.max(this.minute, msg.minute) : msg.minute;
    this.homeScore = msg.homeScore;
    this.awayScore = msg.awayScore;
    this.homeReds = msg.homeReds;
    this.awayReds = msg.awayReds;
    this.isFinal = this.isFinal || msg.isFinal;
    if (msg.phase !== undefined) {
      const parsed = Number(msg.phase);
      if (Number.isFinite(parsed)) this.statusId = parsed;
    }
    this.homePressureRaw += this.classWeight(msg.possession.home);
    this.awayPressureRaw += this.classWeight(msg.possession.away);
  }

  private matchPhase(): MatchPhase {
    if (isPenaltiesPhase(this.statusId)) return "penalties";
    if (isExtraTimePhase(this.statusId)) return "extraTime";
    return "regulation";
  }

  private stoppageActive(): boolean {
    return isStoppageTime(
      this.statusId,
      this.minute,
      this.policy.model.match_regulation_minutes,
      this.policy.model.match_regulation_minutes + this.policy.model.match_extra_time_minutes,
    );
  }

  /** Decayed pressure scalars in [0,1] (per side, boosts that side's remaining lambda). */
  pressureScalars(atTs?: number): { home: number; away: number } {
    if (atTs != null) this.decayTo(atTs);
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    return { home: clamp01(this.homePressureRaw), away: clamp01(this.awayPressureRaw) };
  }

  /**
   * Updates and reads the mutual-danger latch: both sides sustaining the pressure threshold
   * simultaneously for at least min_duration_ms. Driven only by `now` (feed ts), so replay
   * reproduces the exact same activation instant.
   *
   * With the default decay_half_life_ms equal to min_duration_ms, a single momentary event
   * decays below pressure_threshold well before the duration window elapses — by design.
   * "Sustained" mutual danger requires the danger-event stream itself to keep reinforcing
   * pressure on both sides (repeated shots/dangerous free-kicks), matching a genuinely
   * dangerous spell rather than one blip left to fade.
   */
  private mutualDangerActive(p: { home: number; away: number }, now: number): boolean {
    const cfg = this.policy.model.mutual_danger;
    const bothHighPressure = p.home >= cfg.pressure_threshold && p.away >= cfg.pressure_threshold;
    if (!bothHighPressure) {
      this.mutualDangerSinceTs = null;
      return false;
    }
    if (this.mutualDangerSinceTs === null) this.mutualDangerSinceTs = now;
    return now - this.mutualDangerSinceTs >= cfg.min_duration_ms;
  }

  tissueState(atTs?: number): TissueState {
    const p = this.pressureScalars(atTs);
    const now = atTs ?? this.lastTs ?? 0;
    return {
      minute: this.minute,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      homeReds: this.homeReds,
      awayReds: this.awayReds,
      homePressure: p.home,
      awayPressure: p.away,
      matchPhase: this.matchPhase(),
      stoppageActive: this.stoppageActive(),
      mutualDangerActive: this.mutualDangerActive(p, now),
    };
  }
}
