import type { Network } from "@tissue/shared";

/**
 * Message-id dedupe + heartbeat/gap detection (PRD §3 feed-health gate). Pure and
 * clock-injected: `nowMs` is passed in, never read here, so the same event trace yields
 * the same health verdicts under replay. A gap beyond `maxGapMs` ⇒ caller HALTs.
 */

export interface HealthVerdict {
  readonly network: Network;
  readonly gapMs: number;
  readonly stale: boolean; // soft-stale: pull quotes
  readonly gapHalt: boolean; // hard gap: cancel all, SAFE
}

export class FeedHealthTracker {
  private seen = new Set<string>();
  private lastActivityMs: number | null = null;

  constructor(
    private readonly network: Network,
    private readonly maxGapMs: number,
    private readonly softStaleMs: number,
    private readonly dedupeWindow = 20000,
  ) {}

  /** Returns true if this message id is new (should be processed). */
  accept(msgId: string): boolean {
    if (this.seen.has(msgId)) return false;
    this.seen.add(msgId);
    if (this.seen.size > this.dedupeWindow) {
      // bound memory; oldest-insertion eviction (Set preserves insertion order)
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    return true;
  }

  /** Record liveness (a data message OR a heartbeat) at feed time `nowMs`. */
  mark(nowMs: number): void {
    this.lastActivityMs = nowMs;
  }

  verdict(nowMs: number): HealthVerdict {
    const gapMs = this.lastActivityMs == null ? 0 : Math.max(0, nowMs - this.lastActivityMs);
    return {
      network: this.network,
      gapMs,
      stale: gapMs >= this.softStaleMs,
      gapHalt: gapMs >= this.maxGapMs,
    };
  }
}
