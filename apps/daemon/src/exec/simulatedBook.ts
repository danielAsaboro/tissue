import {
  type Intent,
  type IntentStatus,
  type MarketKey,
  type Millis,
  type Selection,
  type Side,
  marketKeyString,
  milliOdds,
  units,
} from "@tissue/shared";
import type { QuoteProposal } from "../strategy/strategy.js";
import {
  type ExecPort,
  type ExternalIntent,
  type Fill,
  type SettlementResult,
  TISSUE_OWNER,
} from "./port.js";

/**
 * SIMULATED maker book. [LANE: Tim / shared]. Holds Tissue's resting intents and matches
 * incoming EXTERNAL intents against them only — never external-vs-external, never
 * self-match (an external whose owner is Tissue is skipped). This is the honest stand-in
 * for the sponsor's not-yet-shipped orderbook; every Intent and Fill it emits is
 * `simulated: true`, and the label rides through logs/ledger/dashboard/demo unchanged.
 */

export class SimulatedBook implements ExecPort {
  readonly simulated: boolean;
  private readonly intents = new Map<string, Intent>();
  private readonly fills: Fill[] = [];
  private seq = 0;

  constructor(private readonly simulateMatching = true) {
    this.simulated = simulateMatching;
  }

  postIntent(p: QuoteProposal, fixtureId: string, msgId: string, createdTs: Millis): Intent {
    const id = `${this.simulateMatching ? "SIM" : "QUOTE"}:${fixtureId}:${String(++this.seq).padStart(5, "0")}`;
    const intent: Intent = {
      id,
      fixtureId,
      marketKey: p.marketKey,
      selection: p.selection,
      side: p.side,
      priceMilliOdds: milliOdds(p.priceMilliOdds),
      sizeUnits: units(p.sizeUnits),
      filledUnits: units(0),
      status: "Posted",
      simulated: this.simulateMatching,
      createdMsgId: msgId,
      createdTs,
    };
    this.intents.set(id, intent);
    return intent;
  }

  replaceIntent(id: string, priceMilliOdds: number, sizeUnits: number, atTs: Millis): Intent | null {
    const cur = this.intents.get(id);
    if (!cur || cur.status === "Settled" || cur.status === "Cancelled") return null;
    const next: Intent = {
      ...cur,
      priceMilliOdds: milliOdds(priceMilliOdds),
      sizeUnits: units(sizeUnits),
      // residual re-quote: keep filledUnits; status reflects remaining size
      status: cur.filledUnits > 0 ? "PartiallyMatched" : "Posted",
      // A repriced quote is a fresh price — reset the staleness clock (strategy/staleQuote.ts).
      createdTs: atTs,
    };
    this.intents.set(id, next);
    return next;
  }

  cancelIntent(id: string): Intent | null {
    const cur = this.intents.get(id);
    if (!cur || cur.status === "Settled") return null;
    const next: Intent = { ...cur, status: "Cancelled" };
    this.intents.set(id, next);
    return next;
  }

  submitExternal(ext: ExternalIntent): Fill[] {
    if (!this.simulateMatching) return [];
    // Self-match guard: Tissue never trades against its own intents.
    if (ext.owner === TISSUE_OWNER) return [];

    const produced: Fill[] = [];
    let remaining = ext.sizeUnits;
    const key = marketKeyString(ext.marketKey);

    // Match only against Tissue's resting intents on the same selection + opposite side,
    // best price first (price-time priority at the maker's resting odds).
    const candidates = [...this.intents.values()]
      .filter(
        (i) =>
          marketKeyString(i.marketKey) === key &&
          i.selection === ext.selection &&
          i.side !== ext.side &&
          (i.status === "Posted" || i.status === "PartiallyMatched") &&
          crosses(i.side, i.priceMilliOdds, ext.side, ext.priceMilliOdds),
      )
      .sort((a, b) => makerPriority(a.side, a.priceMilliOdds) - makerPriority(b.side, b.priceMilliOdds));

    for (const maker of candidates) {
      if (remaining <= 0) break;
      const avail = maker.sizeUnits - maker.filledUnits;
      if (avail <= 0) continue;
      const fillSize = Math.min(avail, remaining);
      remaining -= fillSize;

      const newFilled = maker.filledUnits + fillSize;
      const status: IntentStatus = newFilled >= maker.sizeUnits ? "Matched" : "PartiallyMatched";
      this.intents.set(maker.id, { ...maker, filledUnits: units(newFilled), status });

      const fill: Fill = {
        tissueIntentId: maker.id,
        marketKey: maker.marketKey,
        selection: maker.selection,
        tissueSide: maker.side,
        priceMilliOdds: maker.priceMilliOdds,
        sizeUnits: fillSize,
        counterparty: ext.owner,
        simulated: true,
      };
      produced.push(fill);
      this.fills.push(fill);
    }
    return produced;
  }

  openIntents(): readonly Intent[] {
    return [...this.intents.values()].filter(
      (i) => i.status === "Posted" || i.status === "PartiallyMatched",
    );
  }

  allIntents(): readonly Intent[] {
    return [...this.intents.values()];
  }

  allFills(): readonly Fill[] {
    return this.fills;
  }

  /**
   * Settle every matched position against the final score. BACK wins (profit at odds) if
   * the selection occurred; LAY wins the stake if it did not. All PnL is simulated.
   */
  settle(homeScore: number, awayScore: number): SettlementResult {
    const perIntentPnlUnits: Record<string, number> = {};
    let total = 0;
    for (const f of this.fills) {
      const outcome = selectionOutcome(f.selection, f.marketKey, homeScore, awayScore);
      let pnl: number;
      if (outcome === "PUSH") {
        // Total lands exactly on the line: stake refunded, no profit or loss for either side.
        pnl = 0;
      } else {
        const won = outcome === "WON";
        const decimal = f.priceMilliOdds / 1000;
        if (f.tissueSide === "BACK") {
          pnl = won ? Math.round(f.sizeUnits * (decimal - 1)) : -f.sizeUnits;
        } else {
          pnl = won ? -Math.round(f.sizeUnits * (decimal - 1)) : f.sizeUnits;
        }
      }
      perIntentPnlUnits[f.tissueIntentId] = (perIntentPnlUnits[f.tissueIntentId] ?? 0) + pnl;
      total += pnl;
    }
    return { perIntentPnlUnits, totalPnlUnits: total, simulated: this.simulateMatching };
  }
}

/** Maker/taker crossing rule (see port.ts): opposite sides cross at the maker's resting odds. */
export function crosses(
  makerSide: Side,
  makerOdds: number,
  takerSide: Side,
  takerOdds: number,
): boolean {
  if (makerSide === takerSide) return false;
  return makerSide === "BACK" ? takerOdds <= makerOdds : takerOdds >= makerOdds;
}

/** Sort key so the maker offering the best price to the taker is matched first. */
function makerPriority(side: Side, odds: number): number {
  // BACK maker (buyer) best = highest odds first; LAY maker (seller) best = lowest odds first.
  return side === "BACK" ? -odds : odds;
}

export type SelectionOutcome = "WON" | "LOST" | "PUSH";

/**
 * 1X2 always resolves WON/LOST (no push). TOTALS pushes when the final total lands exactly
 * on the line — an integer line (e.g. O/U 2.0) is reachable by a real scoreline, so this is
 * not a theoretical edge case. A push refunds the stake on both BACK and LAY (settle()).
 */
function selectionOutcome(
  selection: Selection,
  marketKey: MarketKey,
  homeScore: number,
  awayScore: number,
): SelectionOutcome {
  if (marketKey.market === "1X2") {
    if (selection === "HOME") return homeScore > awayScore ? "WON" : "LOST";
    if (selection === "AWAY") return awayScore > homeScore ? "WON" : "LOST";
    return homeScore === awayScore ? "WON" : "LOST"; // DRAW
  }
  const line = (marketKey.lineTimes10 ?? 25) / 10;
  const total = homeScore + awayScore;
  if (total === line) return "PUSH";
  return selection === "OVER" ? (total > line ? "WON" : "LOST") : (total < line ? "WON" : "LOST");
}
