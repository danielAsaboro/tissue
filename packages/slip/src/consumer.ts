import { address, type Address, type Instruction } from "@solana/kit";
import {
  calculateMarket,
  calculateMarketRulebookHash,
  calculateRulebookHash,
  createSlipClient,
  formatAmount,
  parseAmount,
  type BuyTicketRequest,
  type CompiledRulebook,
  type CreateMarketRequest,
  type MarketInstructions,
  type MarketReferenceV1,
  type MarketSnapshot,
  type SlipClient,
  type TicketSnapshot,
} from "@slip/sdk";
import type { TissueSlipConfig } from "./config.js";

export interface SlipOutcomeView {
  readonly index: number;
  readonly label: string;
  readonly pool: string;
  readonly probabilityBps: number;
  readonly projectedPayout: string | null;
}

export interface TissueSlipMarketView {
  readonly address: string;
  readonly fixtureId: string;
  readonly creator: string;
  readonly settlementMint: string;
  readonly status: MarketSnapshot["status"];
  readonly rulebookHash: string;
  readonly expression: MarketSnapshot["expression"];
  readonly bands: readonly {
    lowerInclusive: string | null;
    upperExclusive: string | null;
    outcomeIndex: number;
  }[];
  readonly entryDeadline: number;
  readonly resolveAt: number;
  readonly voidAt: number;
  readonly feeBps: number;
  readonly tipBps: number;
  readonly totalPool: string;
  readonly protocolFee: string;
  readonly resolverTip: string;
  readonly distributablePool: string;
  readonly winningOutcome: number | null;
  readonly outcomes: readonly SlipOutcomeView[];
}

export interface TissueSlipTicketView {
  readonly address: string;
  readonly market: string;
  readonly owner: string;
  readonly nonce: string;
  readonly outcomeIndex: number;
  readonly stake: string;
  readonly claimed: boolean;
}

export interface PreparedSlipAction {
  readonly kind: "create" | "buy" | "claim" | "refund" | "resolve" | "void";
  readonly instructions: readonly Instruction[];
  readonly market?: string;
  readonly ticket?: string;
}

export interface SlipReader {
  supportsUnifiedMarkets(): Promise<boolean>;
  getMarket(market: Address): Promise<MarketSnapshot>;
  listMarkets(): Promise<MarketSnapshot[]>;
  listWalletTickets(owner: Address): Promise<TicketSnapshot[]>;
  verifyReference(input: unknown): Promise<{ reference: MarketReferenceV1; market: MarketSnapshot }>;
  watchMarket(market: Address, listener: (snapshot: MarketSnapshot) => void, onError?: (error: Error) => void): () => void;
  createMarket(request: CreateMarketRequest): Promise<MarketInstructions>;
  buyTicket(request: BuyTicketRequest): Promise<{ readonly ticket: Address; readonly instructions: readonly Instruction[] }>;
  claimTicket(input: { market: Address; ticket: Address; caller: Address }): Promise<readonly Instruction[]>;
  claimRefund(input: { market: Address; ticket: Address; caller: Address }): Promise<readonly Instruction[]>;
  voidMarket(input: { market: Address; caller: Address }): readonly Instruction[];
  resolveMarket(input: Parameters<SlipClient["resolveMarket"]>[0]): Promise<readonly Instruction[]>;
}

export class TissueSlipConsumer {
  constructor(
    readonly config: TissueSlipConfig,
    private readonly client: SlipReader = createSlipClient(config),
  ) {}

  supportsUnifiedMarkets(): Promise<boolean> {
    return this.client.supportsUnifiedMarkets();
  }

  async listMarkets(filter: { fixtureId?: string; status?: MarketSnapshot["status"]; stake?: string } = {}): Promise<TissueSlipMarketView[]> {
    const snapshots = (await this.client.listMarkets()).filter((market) =>
      (filter.fixtureId === undefined || String(market.expression.fixtureId) === filter.fixtureId)
      && (filter.status === undefined || market.status === filter.status));
    return Promise.all(snapshots.map((market) => this.view(market, filter.stake)));
  }

  async inspectMarket(marketAddress: string, stake?: string): Promise<TissueSlipMarketView> {
    return this.view(await this.client.getMarket(address(marketAddress)), stake);
  }

  async verifyReference(reference: unknown, stake?: string): Promise<{ reference: MarketReferenceV1; market: TissueSlipMarketView }> {
    const verified = await this.client.verifyReference(reference);
    return { reference: verified.reference, market: await this.view(verified.market, stake) };
  }

  async listWalletTickets(owner = this.config.watchedWallet): Promise<TissueSlipTicketView[]> {
    if (!owner) throw new Error("No Slip wallet was supplied; pass an owner or configure TISSUE_SLIP_WALLET");
    return (await this.client.listWalletTickets(address(owner))).map(ticketView);
  }

  watchMarket(
    marketAddress: string,
    listener: (market: TissueSlipMarketView) => void,
    onError?: (error: Error) => void,
    stake?: string,
  ): () => void {
    return this.client.watchMarket(address(marketAddress), (snapshot) => {
      void this.view(snapshot, stake).then(listener, onError);
    }, onError);
  }

  /** Compiles and hashes the rulebook, then prepares the real create-market instructions. */
  async prepareCreateMarket(request: {
    id: bigint;
    creator: string;
    rulebook: Omit<CompiledRulebook, "hash">;
  }): Promise<PreparedSlipAction> {
    const rulebook: CompiledRulebook = { ...request.rulebook, hash: await calculateRulebookHash(request.rulebook) };
    const prepared = await this.client.createMarket({ id: request.id, creator: address(request.creator), rulebook });
    return { kind: "create", market: prepared.market, instructions: prepared.instructions };
  }

  async prepareBuy(request: Omit<BuyTicketRequest, "market" | "buyer" | "amount"> & { market: string; buyer: string; amount: string }): Promise<PreparedSlipAction> {
    const prepared = await this.client.buyTicket({
      ...request,
      market: address(request.market),
      buyer: address(request.buyer),
      amount: parseAmount(request.amount),
    });
    return { kind: "buy", ticket: prepared.ticket, instructions: prepared.instructions };
  }

  async prepareClaim(input: { market: string; ticket: string; caller: string }): Promise<PreparedSlipAction> {
    return {
      kind: "claim",
      instructions: await this.client.claimTicket({ market: address(input.market), ticket: address(input.ticket), caller: address(input.caller) }),
    };
  }

  async prepareRefund(input: { market: string; ticket: string; caller: string }): Promise<PreparedSlipAction> {
    return {
      kind: "refund",
      instructions: await this.client.claimRefund({ market: address(input.market), ticket: address(input.ticket), caller: address(input.caller) }),
    };
  }

  prepareVoid(input: { market: string; caller: string }): PreparedSlipAction {
    return { kind: "void", instructions: this.client.voidMarket({ market: address(input.market), caller: address(input.caller) }) };
  }

  async prepareResolve(input: Parameters<SlipClient["resolveMarket"]>[0]): Promise<PreparedSlipAction> {
    return { kind: "resolve", instructions: await this.client.resolveMarket(input) };
  }

  private async view(snapshot: MarketSnapshot, stakeText?: string): Promise<TissueSlipMarketView> {
    if (snapshot.mint !== this.config.settlementMint) {
      throw new Error("Slip market settlement mint does not match Tissue configuration");
    }
    const stake = stakeText === undefined ? 1_000_000n : parseAmount(stakeText);
    const calculated = calculateMarket(snapshot.pools, snapshot.feeBps, snapshot.tipBps);
    return {
      address: snapshot.address,
      fixtureId: String(snapshot.expression.fixtureId),
      creator: snapshot.creator,
      settlementMint: snapshot.mint,
      status: snapshot.status,
      rulebookHash: await calculateMarketRulebookHash(snapshot),
      expression: snapshot.expression,
      bands: snapshot.bands.map((band) => ({
        lowerInclusive: band.lowerInclusive === null ? null : String(band.lowerInclusive),
        upperExclusive: band.upperExclusive === null ? null : String(band.upperExclusive),
        outcomeIndex: band.outcomeIndex,
      })),
      entryDeadline: snapshot.entryDeadline,
      resolveAt: snapshot.resolveAt,
      voidAt: snapshot.voidAt,
      feeBps: snapshot.feeBps,
      tipBps: snapshot.tipBps,
      totalPool: formatAmount(calculated.total),
      protocolFee: formatAmount(calculated.fee),
      resolverTip: formatAmount(calculated.resolverTip),
      distributablePool: formatAmount(calculated.net),
      winningOutcome: snapshot.winningOutcome,
      outcomes: calculated.outcomes.map((outcome, index) => {
        const projectedPayout = outcome.projectedPayout(stake);
        return {
          index,
          label: snapshot.outcomeLabels[index]!,
          pool: formatAmount(outcome.pool),
          probabilityBps: outcome.probabilityBps,
          projectedPayout: projectedPayout === null ? null : formatAmount(projectedPayout),
        };
      }),
    };
  }
}

function ticketView(ticket: TicketSnapshot): TissueSlipTicketView {
  return {
    address: ticket.address,
    market: ticket.market,
    owner: ticket.owner,
    nonce: String(ticket.nonce),
    outcomeIndex: ticket.outcomeIndex,
    stake: formatAmount(ticket.stake),
    claimed: ticket.claimed,
  };
}
