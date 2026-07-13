import {
  type ExposureSnapshot,
  type Intent,
  type InventorySnapshot,
  type MarketKey,
  marketKeyString,
} from "@tissue/shared";

/**
 * Exposure + inventory accounting (PRD §5). [LANE: Tim]. Stateful but deterministic: it is
 * driven only by intent-lifecycle events fed to it in message order — no clock, no I/O.
 * The risk gate reads its snapshot to enforce caps, drawdown kill, and inventory skew.
 */

export class ExposureTracker {
  private readonly open = new Map<string, Intent>();
  /** Signed matched inventory per `${marketKey}:${selection}` (+ long via BACK, − via LAY). */
  private readonly inventory = new Map<string, number>();
  private realizedPnlUnits = 0;
  private peakEquityUnits = 0;

  constructor(private readonly startingBankrollUnits: number) {
    this.peakEquityUnits = 0;
  }

  upsertOpen(intent: Intent): void {
    if (intent.status === "Cancelled" || intent.status === "Settled") {
      this.open.delete(intent.id);
    } else {
      this.open.set(intent.id, intent);
    }
  }

  onFill(intent: Intent, filledUnits: number): void {
    const key = `${marketKeyString(intent.marketKey)}:${intent.selection}`;
    const signed = intent.side === "BACK" ? filledUnits : -filledUnits;
    this.inventory.set(key, (this.inventory.get(key) ?? 0) + signed);
  }

  onSettle(pnlUnits: number): void {
    this.realizedPnlUnits += pnlUnits;
    const equity = this.realizedPnlUnits;
    if (equity > this.peakEquityUnits) this.peakEquityUnits = equity;
  }

  perMarketOpenUnits(marketKey: MarketKey): number {
    const key = marketKeyString(marketKey);
    let sum = 0;
    for (const i of this.open.values()) {
      if (marketKeyString(i.marketKey) === key) sum += i.sizeUnits;
    }
    return sum;
  }

  perFixtureOpenUnits(): number {
    let sum = 0;
    for (const i of this.open.values()) sum += i.sizeUnits;
    return sum;
  }

  openIntentCount(): number {
    return this.open.size;
  }

  /** Normalized inventory in a selection, ~[-1,1], scaled by the per-market cap. */
  inventoryNorm(selKey: string, capUnits: number): number {
    const inv = this.inventory.get(selKey) ?? 0;
    if (capUnits <= 0) return 0;
    return Math.max(-1, Math.min(1, inv / capUnits));
  }

  inventorySnapshot(): InventorySnapshot {
    const bySelection: Record<string, number> = {};
    let net = 0;
    for (const [k, v] of this.inventory) {
      bySelection[k] = v;
      net += v;
    }
    return { bySelection, netUnits: net };
  }

  snapshot(): ExposureSnapshot {
    const perMarketUnits: Record<string, number> = {};
    for (const i of this.open.values()) {
      const k = marketKeyString(i.marketKey);
      perMarketUnits[k] = (perMarketUnits[k] ?? 0) + i.sizeUnits;
    }
    const equity = this.realizedPnlUnits;
    const drawdown = Math.max(0, this.peakEquityUnits - equity);
    return {
      perMarketUnits,
      perFixtureUnits: this.perFixtureOpenUnits(),
      openIntents: this.open.size,
      realizedPnlUnits: this.realizedPnlUnits,
      peakEquityUnits: this.peakEquityUnits,
      drawdownUnits: drawdown,
    };
  }
}
