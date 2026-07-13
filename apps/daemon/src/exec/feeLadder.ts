/**
 * Priority-fee ladder for devnet congestion (PRD §Phase 6). Pure/stateful. On a failed or
 * congested submission, escalate through the configured microlamports/CU rungs; once the
 * ladder is exhausted, `escalate()` returns null → the caller HALTS that market rather than
 * failing silently.
 */

export class FeeLadder {
  private rung = 0;
  constructor(
    private readonly ladderMicroLamports: readonly number[],
    private readonly maxRetries: number,
  ) {}

  current(): number {
    return this.ladderMicroLamports[Math.min(this.rung, this.ladderMicroLamports.length - 1)] ?? 0;
  }

  /** Move to the next rung. Returns the new fee, or null when the ladder is exhausted. */
  escalate(): number | null {
    this.rung += 1;
    if (this.rung >= this.ladderMicroLamports.length || this.rung > this.maxRetries) return null;
    return this.current();
  }

  reset(): void {
    this.rung = 0;
  }

  get exhausted(): boolean {
    return this.rung >= this.ladderMicroLamports.length || this.rung > this.maxRetries;
  }
}
