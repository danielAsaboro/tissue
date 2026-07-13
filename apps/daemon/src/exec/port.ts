import type { Intent, MarketKey, Selection, Side } from "@tissue/shared";
import type { QuoteProposal } from "../strategy/strategy.js";

/**
 * Execution PORT (PRD §Phase 6 + HANDOFF D-001). The daemon talks only to this interface.
 * Today the only implementation is the SIMULATED maker book (matching) plus the REAL
 * validate_odds anchoring adapter (provenance). A future real permissionless orderbook
 * (sponsor: "in preparation") implements the same port and swaps in with no caller change.
 *
 * INVARIANT: every Intent this port returns carries `simulated: true` while book_mode is
 * "simulated". That flag is surfaced verbatim everywhere downstream — a simulated fill is
 * never presented as a real counterparty fill.
 */

export type ExternalOwner = string;
export const TISSUE_OWNER: ExternalOwner = "tissue";

/** An opposing intent from another participant on the book (in replay: scripted takers). */
export interface ExternalIntent {
  readonly owner: ExternalOwner;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side: Side;
  readonly priceMilliOdds: number;
  readonly sizeUnits: number;
}

export interface Fill {
  readonly tissueIntentId: string;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly tissueSide: Side;
  readonly priceMilliOdds: number;
  readonly sizeUnits: number;
  readonly counterparty: ExternalOwner;
  /** Always true under the simulated book; explicit for the ledger + dashboard. */
  readonly simulated: boolean;
}

export interface SettlementResult {
  readonly perIntentPnlUnits: Record<string, number>;
  readonly totalPnlUnits: number;
  readonly simulated: boolean;
}

export interface ExecPort {
  readonly simulated: boolean;
  postIntent(proposal: QuoteProposal, fixtureId: string, msgId: string): Intent;
  replaceIntent(id: string, priceMilliOdds: number, sizeUnits: number): Intent | null;
  cancelIntent(id: string): Intent | null;
  /** Submit an external (counterparty) intent; the solver matches it vs Tissue's own only. */
  submitExternal(ext: ExternalIntent): Fill[];
  openIntents(): readonly Intent[];
  settle(homeScore: number, awayScore: number): SettlementResult;
}
