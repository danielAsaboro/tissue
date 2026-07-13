import type { Intent, MarketKey, Selection, Side } from "@tissue/shared";
import type { QuoteProposal } from "../strategy/strategy.js";

/**
 * Execution PORT (PRD §Phase 6 + HANDOFF D-001). The daemon talks only to this interface.
 * Live mode uses this boundary as a quote-publication book with matching disabled. Replay
 * tests can opt into deterministic simulated matching. A future real permissionless
 * orderbook implements the same port without changing pricing or risk.
 *
 * INVARIANT: only explicit replay mode may return simulated fills. Live quote publication
 * returns `simulated: false` and never produces fills or realized PnL.
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
  /** True only under explicit replay matching. */
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
