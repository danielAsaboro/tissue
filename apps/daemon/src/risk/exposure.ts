import {
  type ExposureSnapshot,
  type Intent,
  type InventorySnapshot,
  type MarketKey,
  marketKeyString,
} from "@tissue/shared";
import { quoteLiabilityUnits } from "./liability.js";

/**
 * Exposure + inventory accounting (PRD §5). [LANE: Tim]. Stateful but deterministic: it is
 * driven only by intent-lifecycle events fed to it in message order — no clock, no I/O.
 * The risk gate reads its snapshot to enforce caps, drawdown kill, and inventory skew.
 */

export class ExposureTracker {
  private readonly open = new Map<string, Intent>();
  /** Signed matched inventory per `${marketKey}:${selection}` (+ long via BACK, − via LAY). */
  private readonly inventory = new Map<string, number>();
  /** Gross unresolved maximum loss already matched, by market. Conservative by design:
   * opposing positions are not netted without a complete outcome-aware margin model. */
  private readonly matchedLiabilityByMarket = new Map<string, number>();
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
    const liability = quoteLiabilityUnits(intent.side, intent.priceMilliOdds, filledUnits);
    const signed = intent.side === "BACK" ? liability : -liability;
    this.inventory.set(key, (this.inventory.get(key) ?? 0) + signed);
    const marketKey = marketKeyString(intent.marketKey);
    this.matchedLiabilityByMarket.set(
      marketKey,
      (this.matchedLiabilityByMarket.get(marketKey) ?? 0) + liability,
    );

    // Keep the risk view synchronized with the book's fill lifecycle. Previously the
    // tracker retained the original unfilled intent and then dropped matched positions,
    // allowing the same capital cap to be reused repeatedly before settlement.
    const current = this.open.get(intent.id);
    if (current) {
      const nextFilled = Math.min(current.sizeUnits, current.filledUnits + filledUnits);
      if (nextFilled >= current.sizeUnits) this.open.delete(current.id);
      else this.open.set(current.id, { ...current, filledUnits: nextFilled as never, status: "PartiallyMatched" });
    }
  }

  onSettle(pnlUnits: number): void {
    this.realizedPnlUnits += pnlUnits;
    const equity = this.realizedPnlUnits;
    if (equity > this.peakEquityUnits) this.peakEquityUnits = equity;
    this.matchedLiabilityByMarket.clear();
    this.inventory.clear();
  }

  perMarketExposureUnits(marketKey: MarketKey): number {
    const key = marketKeyString(marketKey);
    let sum = 0;
    for (const i of this.open.values()) {
      if (marketKeyString(i.marketKey) === key) {
        sum += quoteLiabilityUnits(i.side, i.priceMilliOdds, i.sizeUnits - i.filledUnits);
      }
    }
    return sum + (this.matchedLiabilityByMarket.get(key) ?? 0);
  }

  perFixtureExposureUnits(): number {
    let sum = 0;
    for (const i of this.open.values()) {
      sum += quoteLiabilityUnits(i.side, i.priceMilliOdds, i.sizeUnits - i.filledUnits);
    }
    for (const liability of this.matchedLiabilityByMarket.values()) sum += liability;
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
      perMarketUnits[k] = (perMarketUnits[k] ?? 0)
        + quoteLiabilityUnits(i.side, i.priceMilliOdds, i.sizeUnits - i.filledUnits);
    }
    for (const [k, liability] of this.matchedLiabilityByMarket) {
      perMarketUnits[k] = (perMarketUnits[k] ?? 0) + liability;
    }
    const equity = this.realizedPnlUnits;
    const drawdown = Math.max(0, this.peakEquityUnits - equity);
    return {
      perMarketUnits,
      perFixtureUnits: this.perFixtureExposureUnits(),
      openIntents: this.open.size,
      realizedPnlUnits: this.realizedPnlUnits,
      peakEquityUnits: this.peakEquityUnits,
      drawdownUnits: drawdown,
    };
  }
}
