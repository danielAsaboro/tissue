import { createHash } from "node:crypto";
import { Connection, Transaction, TransactionInstruction, type Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { AccountRole, address, type Instruction } from "@solana/kit";
import { TissueSlipConsumer, type TissueSlipConfig, type TissueSlipMarketView } from "@tissue/slip";
import type { MarketKey, ScoreMessage, Selection } from "@tissue/shared";
import { isConfirmedSignature, loadKeypair } from "./anchorLive.js";
import { fetchSlipResolutionProof, type ScoreAnchorOptions } from "./scoreAnchorLive.js";
import type { VenueExecutionEvidence } from "./venue.js";

/**
 * Real Slip execution. TxLINE (txoracle) has no order/execution instructions — confirmed in
 * GROUND-TRUTH.md T1 — so Tissue's pricing edge never used to turn into a signed transaction.
 * Slip is a real, separate settlement venue (pari-mutuel outcome-band pools) with real
 * instruction builders (packages/slip). This module is the wiring that was always missing:
 * TxLINE stays the trigger/event source, Slip becomes the venue Tissue actually trades on.
 *
 * Market model mismatch with ExecPort: Slip has no cancel/replace/counterparty matching, only
 * "stake into a band before entryDeadline, resolve from a real score proof, claim." So this is
 * a parallel execution path, not a new ExecPort implementation — postIntent-style quoting is
 * unaffected; this only fires for markets/selections real capital is allowed to risk (config).
 */

const SOCCER_STAT_KEY = { HOME_GOALS: 1, AWAY_GOALS: 2 } as const;
const FULL_MATCH_PERIOD = 100; // TxLINE encoding: period 100 == game_finalised (GROUND-TRUTH.md)
function isMissingSlipAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:account|market).*(?:does not exist|not found|missing)|could not find account/i.test(message);
}

export interface SlipRulebookMapping {
  readonly expression: {
    readonly fixtureId: number;
    readonly settlementMode: "Terminal";
    readonly period: number;
    readonly statAKey: number;
    readonly statASide: "Home" | "Away" | "Total";
    readonly statBKey: number | null;
    readonly statBSide: "Home" | "Away" | "Total" | null;
    readonly op: "Add" | "Sub" | "Min" | null;
  };
  readonly outcomeLabels: readonly string[];
  readonly bands: ReadonlyArray<{ lowerInclusive: bigint | null; upperExclusive: bigint | null; outcomeIndex: number }>;
  readonly selectionToOutcomeIndex: (selection: Selection) => number;
}

/**
 * Maps Tissue's own MarketKey/Selection onto a Slip rulebook expression over TxLINE's real
 * soccer stat keys (home/away goals, period 100 = full match) — the same stat-key encoding
 * Tissue already verifies via validate_stat (see ingest/soccerFeed.ts).
 */
export function mapMarketKeyToSlipRulebook(fixtureId: string, marketKey: MarketKey): SlipRulebookMapping {
  const fixtureIdNum = Number(fixtureId);
  if (marketKey.market === "1X2") {
    return {
      expression: {
        fixtureId: fixtureIdNum,
        settlementMode: "Terminal",
        period: FULL_MATCH_PERIOD,
        statAKey: SOCCER_STAT_KEY.HOME_GOALS,
        statASide: "Home",
        statBKey: SOCCER_STAT_KEY.AWAY_GOALS,
        statBSide: "Away",
        op: "Sub",
      },
      outcomeLabels: ["Away", "Draw", "Home"],
      bands: [
        { lowerInclusive: null, upperExclusive: 0n, outcomeIndex: 0 },
        { lowerInclusive: 0n, upperExclusive: 1n, outcomeIndex: 1 },
        { lowerInclusive: 1n, upperExclusive: null, outcomeIndex: 2 },
      ],
      selectionToOutcomeIndex: (selection) => {
        if (selection === "AWAY") return 0;
        if (selection === "DRAW") return 1;
        if (selection === "HOME") return 2;
        throw new Error(`Selection ${selection} is not valid for a 1X2 Slip market`);
      },
    };
  }
  if (marketKey.lineTimes10 === undefined) {
    throw new Error("TOTALS market requires a lineTimes10");
  }
  const boundary = BigInt(Math.ceil(marketKey.lineTimes10 / 10));
  return {
    expression: {
      fixtureId: fixtureIdNum,
      settlementMode: "Terminal",
      period: FULL_MATCH_PERIOD,
      statAKey: SOCCER_STAT_KEY.HOME_GOALS,
      statASide: "Home",
      statBKey: SOCCER_STAT_KEY.AWAY_GOALS,
      statBSide: "Away",
      op: "Add",
    },
    outcomeLabels: ["Under", "Over"],
    bands: [
      { lowerInclusive: null, upperExclusive: boundary, outcomeIndex: 0 },
      { lowerInclusive: boundary, upperExclusive: null, outcomeIndex: 1 },
    ],
    selectionToOutcomeIndex: (selection) => {
      if (selection === "UNDER") return 0;
      if (selection === "OVER") return 1;
      throw new Error(`Selection ${selection} is not valid for a TOTALS Slip market`);
    },
  };
}

/** Deterministic market id from (fixtureId, marketKey) so repeated calls target the same market. */
export function deriveSlipMarketId(fixtureId: string, marketKey: MarketKey): bigint {
  const key = `${fixtureId}:${marketKey.market}:${marketKey.lineTimes10 ?? ""}`;
  const digest = createHash("sha256").update(key).digest();
  // Low 62 bits: fits i64 with room to spare, avoids sign-bit ambiguity.
  return digest.readBigUInt64BE(0) & 0x3fffffffffffffffn;
}

export function toWeb3Instruction(instruction: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
      isWritable: account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(instruction.data ?? []),
  });
}

export interface SlipSignAndSendResult {
  readonly status: "confirmed" | "failed";
  readonly txSig?: string;
  readonly slot?: number;
  readonly error?: string;
}

export async function signAndSend(
  connection: Connection,
  instructions: readonly Instruction[],
  payer: Keypair,
): Promise<SlipSignAndSendResult> {
  try {
    const tx = new Transaction().add(...instructions.map(toWeb3Instruction));
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    const txSig = await connection.sendRawTransaction(tx.serialize());
    const confirmed = await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
    if (confirmed.value.err) {
      return { status: "failed", error: `slip tx failed: ${JSON.stringify(confirmed.value.err)}` };
    }
    const status = await connection.getSignatureStatus(txSig, { searchTransactionHistory: true });
    return {
      status: isConfirmedSignature(status.value) ? "confirmed" : "failed",
      txSig,
      ...(status.value?.slot !== undefined ? { slot: status.value.slot } : {}),
    };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

interface SlipConnectionOptions {
  readonly rpcUrl: string;
  readonly keypairPath: string | undefined;
  readonly slipConfig: TissueSlipConfig;
}

export interface SlipExecOptions extends SlipConnectionOptions {
  readonly minVenueEdgeBps: number;
}

export type SlipExecStatus = "confirmed" | "failed" | "rejected-by-gate";

export interface SlipExecutionEvidence extends VenueExecutionEvidence {
  readonly venue: "slip";
  readonly fixtureId: string;
  /** The decision (ledger seq) whose intent this evidence traces back to. */
  readonly decisionSeq: number;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side?: "BACK" | "LAY";
  readonly edgeBps: number;
  readonly tissueProbBps?: number;
  readonly sizeUnits: number;
  readonly outcomeIndex: number;
  readonly stakeAmount: string;
  readonly status: SlipExecStatus;
  readonly market?: string;
  readonly ticket?: string;
  readonly marketCreateTxSig?: string;
  readonly buyTxSig?: string;
  readonly submittedAt: number;
  readonly error?: string;
  readonly lifecycleStatus?: "open" | "resolved" | "claimed" | "voided" | "refunded" | "attention-required";
  readonly lifecycleUpdatedAt?: number;
  readonly resolveTxSig?: string;
  readonly claimTxSig?: string;
  readonly voidTxSig?: string;
  readonly refundTxSig?: string;
  readonly lifecycleError?: string;
  readonly venueBreakevenProbBps?: number;
  readonly venueEdgeBps?: number;
  readonly projectedPayoutAtomic?: string;
}

/** Tissue Units are settlement-mint atomic units on real execution paths. Slip's configured
 * mint has six decimals and its program accepts the raw integer directly. Never route this
 * value through a human-decimal parser: doing so would multiply risk by 1e6. */
export function stakeUnitsToAmount(sizeUnits: number): bigint {
  if (!Number.isSafeInteger(sizeUnits) || sizeUnits <= 0) {
    throw new Error(`Slip stake size must be a positive safe integer of atomic units; received ${sizeUnits}`);
  }
  return BigInt(sizeUnits);
}

/** The only fields executeSlipBuy actually needs — satisfied structurally by both a full
 *  QuoteProposal (replay/tests) and the ledger-derived candidates liveDesk builds from a
 *  DecisionRecord's already risk-approved Intents. */
export interface SlipTradeInput {
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side: "BACK" | "LAY";
  readonly sizeUnits: number;
  readonly edgeBps: number;
  readonly tissueProbBps: number;
}

export interface SlipMarketDiscovery {
  readonly mapping: SlipRulebookMapping;
  readonly outcomeIndex: number;
  readonly market: TissueSlipMarketView;
}

/** Read and validate Tissue's canonical Slip market without signing. This is the adapter's
 * normalized discovery boundary; submission deliberately re-runs it to close the read/sign
 * gap against changed account state. */
export async function discoverSlipMarket(
  proposal: SlipTradeInput,
  fixtureId: string,
  opts: Pick<SlipExecOptions, "keypairPath" | "slipConfig">,
): Promise<SlipMarketDiscovery> {
  const mapping = mapMarketKeyToSlipRulebook(fixtureId, proposal.marketKey);
  const outcomeIndex = mapping.selectionToOutcomeIndex(proposal.selection);
  const payer = loadKeypair(opts.keypairPath, true);
  const consumer = new TissueSlipConsumer(opts.slipConfig);
  const marketId = deriveSlipMarketId(fixtureId, proposal.marketKey);
  const expectedMarket = await consumer.deriveMarketAddress(payer.publicKey.toBase58(), marketId);
  let market: TissueSlipMarketView;
  try {
    market = await consumer.inspectMarket(expectedMarket);
  } catch (error) {
    if (isMissingSlipAccountError(error)) {
      throw new Error(`Canonical Slip market ${expectedMarket} is not provisioned; refusing to create and self-fill an empty pool`, { cause: error });
    }
    throw error;
  }
  assertExistingMarketMatches(market, mapping, fixtureId);
  if (!market.outcomes.some((outcome) => outcome.index !== outcomeIndex && BigInt(outcome.poolAtomic) > 0n)) {
    throw new Error(`Slip market ${market.address} has no opposing liquidity; a one-sided pool is voided by the program`);
  }
  return { mapping, outcomeIndex, market };
}

/**
 * Turns one of Tissue's own risk-approved trading decisions into a real, signed, confirmed
 * Slip transaction: inspect the exact canonical, externally provisioned market and buy the
 * outcome band Tissue's edge favors only when opposing liquidity already exists. Every step submits a real transaction and waits for
 * confirmation — same evidence discipline as exec/memoAnchor.ts. Never invents a fill: a
 * failed on-chain submission is reported as failed, not silently retried into a fabricated
 * success.
 */
export async function executeSlipBuy(
  proposal: SlipTradeInput,
  fixtureId: string,
  decisionSeq: number,
  nonce: bigint,
  opts: SlipExecOptions,
): Promise<SlipExecutionEvidence> {
  const submittedAt = Date.now();
  const mapping = mapMarketKeyToSlipRulebook(fixtureId, proposal.marketKey);
  const outcomeIndex = mapping.selectionToOutcomeIndex(proposal.selection);
  const stakeAmount = stakeUnitsToAmount(proposal.sizeUnits);
  const base = {
    venue: "slip" as const,
    fixtureId,
    decisionSeq,
    marketKey: proposal.marketKey,
    selection: proposal.selection,
    side: proposal.side,
    edgeBps: proposal.edgeBps,
    tissueProbBps: proposal.tissueProbBps,
    sizeUnits: proposal.sizeUnits,
    outcomeIndex,
    stakeAmount: stakeAmount.toString(),
    submittedAt,
  };
  try {
    if (proposal.side !== "BACK") {
      throw new Error("Slip is a buy-only outcome pool; refusing to invert a LAY strategy intent into a buy");
    }
    if (opts.slipConfig.network === "mainnet-beta") {
      throw new Error(
        "Slip mainnet execution is disabled: buyTicket has no atomic minimum-payout/slippage guard; use localnet/devnet until the venue adds one",
      );
    }
    const payer = loadKeypair(opts.keypairPath, true);
    const connection = new Connection(opts.rpcUrl, "confirmed");
    const consumer = new TissueSlipConsumer(opts.slipConfig);
    const discovered = await discoverSlipMarket(proposal, fixtureId, opts);
    const existing = discovered.market;
    const market = existing.address;

    const venueQuote = calculateSlipBuyQuote(existing, outcomeIndex, stakeAmount, proposal.tissueProbBps);
    if (venueQuote.venueEdgeBps < opts.minVenueEdgeBps) {
      throw new Error(
        `Slip post-stake venue edge ${venueQuote.venueEdgeBps}bps is below required ${opts.minVenueEdgeBps}bps`,
      );
    }

    const buyPrepared = await consumer.prepareBuy({
      market: market!,
      buyer: payer.publicKey.toBase58(),
      outcomeIndex,
      amountAtomic: stakeAmount,
      nonce,
    });
    if (!buyPrepared.ticket) {
      return { ...base, status: "failed", market, error: "Slip buy response did not include a ticket address" };
    }
    const buyResult = await signAndSend(connection, buyPrepared.instructions, payer);
    if (buyResult.status !== "confirmed") {
      return {
        ...base,
        status: "failed",
        market,
        error: buyResult.error ?? "buy not confirmed",
      };
    }
    return {
      ...base,
      status: "confirmed",
      market,
      ticket: buyPrepared.ticket,
      venueMarketId: market,
      venuePositionId: buyPrepared.ticket,
      ...(buyResult.txSig ? { buyTxSig: buyResult.txSig } : {}),
      ...(buyResult.txSig ? { submissionTxSig: buyResult.txSig } : {}),
      lifecycleStatus: "open",
      lifecycleUpdatedAt: Date.now(),
      venueBreakevenProbBps: venueQuote.breakevenProbBps,
      venueEdgeBps: venueQuote.venueEdgeBps,
      projectedPayoutAtomic: venueQuote.projectedPayoutAtomic.toString(),
    };
  } catch (error) {
    return { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface SlipBuyQuote {
  readonly projectedPayoutAtomic: bigint;
  readonly breakevenProbBps: number;
  readonly venueEdgeBps: number;
}

/** Exact post-stake pari-mutuel economics. The pre-buy pool weight is not a price: Tissue's
 * own stake moves both total liquidity and the winning pool, and fees reduce payout. */
export function calculateSlipBuyQuote(
  market: Pick<TissueSlipMarketView, "outcomes" | "feeBps" | "tipBps">,
  outcomeIndex: number,
  stakeAtomic: bigint,
  tissueProbBps: number,
): SlipBuyQuote {
  if (stakeAtomic <= 0n) throw new Error("Slip quote stake must be positive");
  if (!Number.isInteger(tissueProbBps) || tissueProbBps < 0 || tissueProbBps > 10_000) {
    throw new Error("Tissue probability must be integer basis points");
  }
  const pools = market.outcomes.map((outcome) => BigInt(outcome.poolAtomic));
  if (outcomeIndex < 0 || outcomeIndex >= pools.length) throw new Error("Slip outcome index is out of range");
  pools[outcomeIndex] = pools[outcomeIndex]! + stakeAtomic;
  const total = pools.reduce((sum, pool) => sum + pool, 0n);
  const net = total
    - total * BigInt(market.feeBps) / 10_000n
    - total * BigInt(market.tipBps) / 10_000n;
  const winningPool = pools[outcomeIndex]!;
  const payout = stakeAtomic * net / winningPool;
  if (payout <= 0n) throw new Error("Slip projected payout is zero");
  const breakeven = Number((stakeAtomic * 10_000n + payout - 1n) / payout);
  return {
    projectedPayoutAtomic: payout,
    breakevenProbBps: breakeven,
    venueEdgeBps: tissueProbBps - breakeven,
  };
}

export interface SlipLifecycleOptions extends SlipConnectionOptions {
  readonly scoreProof: ScoreAnchorOptions;
  readonly now?: () => number;
}

export function nextSlipLifecycleAction(
  status: TissueSlipMarketView["status"],
  terminalScore: ScoreMessage | undefined,
  now: number,
  voidAt: number,
): "resolve" | "void" | "wait" {
  if (status !== "open") return "wait";
  // The hardened Slip program gives timeout precedence: at/after void_at a proof can no
  // longer settle the market. Decide from the same boundary before fetching a proof so a
  // delayed terminal feed cannot create a proof-versus-refund race or an avoidable failure.
  if (now >= voidAt * 1_000) return "void";
  if (terminalScore?.isFinal) return "resolve";
  return "wait";
}

async function waitForSlipState<T>(
  read: () => Promise<T>,
  accepted: (value: T) => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest = await read();
  while (!accepted(latest) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    latest = await read();
  }
  if (!accepted(latest)) throw new Error(`${description} did not become visible before the RPC consistency deadline`);
  return latest;
}

/** Advance one confirmed ticket through the real Slip lifecycle. Every transition is based on
 * canonical on-chain market/ticket state, making retries and restart reconciliation idempotent. */
export async function reconcileSlipExecution(
  evidence: SlipExecutionEvidence,
  terminalScore: ScoreMessage | undefined,
  opts: SlipLifecycleOptions,
): Promise<SlipExecutionEvidence> {
  if (evidence.status !== "confirmed" || !evidence.market || !evidence.ticket) return evidence;
  const now = opts.now?.() ?? Date.now();
  const payer = loadKeypair(opts.keypairPath, true);
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const consumer = new TissueSlipConsumer(opts.slipConfig);
  const update = (fields: Partial<SlipExecutionEvidence>, clearError = false): SlipExecutionEvidence => {
    const result: SlipExecutionEvidence = {
      ...evidence,
      ...fields,
      lifecycleUpdatedAt: now,
    };
    if (clearError) Reflect.deleteProperty(result, "lifecycleError");
    return result;
  };
  let resolveTxSig = evidence.resolveTxSig;
  let voidTxSig = evidence.voidTxSig;

  try {
    const market = await consumer.inspectMarket(evidence.market);
    let canonicalStatus = market.status;
    const ticket = await consumer.inspectTicket(evidence.ticket);
    if (ticket.market !== evidence.market || ticket.owner !== payer.publicKey.toBase58()) {
      throw new Error(`Slip ticket ${evidence.ticket} is not owned by Tissue or does not belong to market ${evidence.market}`);
    }
    if (ticket.claimed) {
      return update({ lifecycleStatus: canonicalStatus === "voided" ? "refunded" : "claimed" }, true);
    }

    const action = nextSlipLifecycleAction(canonicalStatus, terminalScore, now, market.voidAt);
    if (action === "resolve") {
      if (!terminalScore) throw new Error("Slip resolution was selected without a terminal score");
      const resolution = await fetchSlipResolutionProof(terminalScore, opts.scoreProof);
      const prepared = await consumer.prepareResolve({
        market: address(evidence.market),
        resolver: address(payer.publicKey.toBase58()),
        dailyScoresRoots: address(resolution.dailyScoresRoots),
        proof: resolution.proof,
      });
      const result = await signAndSend(connection, prepared.instructions, payer);
      if (result.status !== "confirmed" || !result.txSig) throw new Error(result.error ?? "Slip resolve transaction was not confirmed");
      resolveTxSig = result.txSig;
      canonicalStatus = await waitForSlipState(
        () => consumer.inspectMarket(evidence.market!),
        (candidate) => candidate.status !== "open",
        "confirmed Slip resolution",
      ).then((candidate) => candidate.status);
    } else if (action === "void") {
      const prepared = consumer.prepareVoid({ market: evidence.market, caller: payer.publicKey.toBase58() });
      const result = await signAndSend(connection, prepared.instructions, payer);
      if (result.status !== "confirmed" || !result.txSig) throw new Error(result.error ?? "Slip void transaction was not confirmed");
      voidTxSig = result.txSig;
      canonicalStatus = await waitForSlipState(
        () => consumer.inspectMarket(evidence.market!),
        (candidate) => candidate.status === "voided",
        "confirmed Slip void",
      ).then((candidate) => candidate.status);
    }

    if (canonicalStatus === "resolved") {
      const prepared = await consumer.prepareClaim({ market: evidence.market, ticket: evidence.ticket, caller: payer.publicKey.toBase58() });
      const result = await signAndSend(connection, prepared.instructions, payer);
      if (result.status !== "confirmed" || !result.txSig) throw new Error(result.error ?? "Slip claim transaction was not confirmed");
      await waitForSlipState(
        () => consumer.inspectTicket(evidence.ticket!),
        (candidate) => candidate.claimed,
        "confirmed Slip claim",
      );
      return update({ lifecycleStatus: "claimed", ...(resolveTxSig ? { resolveTxSig, settlementTxSig: resolveTxSig } : {}), claimTxSig: result.txSig }, true);
    }
    if (canonicalStatus === "voided") {
      const prepared = await consumer.prepareRefund({ market: evidence.market, ticket: evidence.ticket, caller: payer.publicKey.toBase58() });
      const result = await signAndSend(connection, prepared.instructions, payer);
      if (result.status !== "confirmed" || !result.txSig) throw new Error(result.error ?? "Slip refund transaction was not confirmed");
      await waitForSlipState(
        () => consumer.inspectTicket(evidence.ticket!),
        (candidate) => candidate.claimed,
        "confirmed Slip refund",
      );
      return update({ lifecycleStatus: "refunded", ...(voidTxSig ? { voidTxSig } : {}), refundTxSig: result.txSig }, true);
    }
    return update({ lifecycleStatus: "open" }, true);
  } catch (error) {
    return update({
      lifecycleStatus: "attention-required",
      ...(resolveTxSig ? { resolveTxSig } : {}),
      ...(voidTxSig ? { voidTxSig } : {}),
      lifecycleError: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertExistingMarketMatches(
  market: Awaited<ReturnType<TissueSlipConsumer["inspectMarket"]>>,
  expected: SlipRulebookMapping,
  fixtureId: string,
): void {
  if (market.status !== "open") {
    throw new Error(`Existing Slip market ${market.address} is ${market.status}, not open for entry`);
  }
  if (market.entryDeadline <= Math.floor(Date.now() / 1000)) {
    throw new Error(`Existing Slip market ${market.address} entry deadline has passed`);
  }
  const expression = market.expression;
  if (
    market.fixtureId !== fixtureId
    || expression.fixtureId !== expected.expression.fixtureId
    || expression.period !== expected.expression.period
    || expression.statAKey !== expected.expression.statAKey
    || expression.statASide !== expected.expression.statASide
    || expression.statBKey !== expected.expression.statBKey
    || expression.statBSide !== expected.expression.statBSide
    || expression.op !== expected.expression.op
    || JSON.stringify(market.outcomes.map((outcome) => outcome.label)) !== JSON.stringify(expected.outcomeLabels)
    || JSON.stringify(market.bands) !== JSON.stringify(expected.bands.map((band) => ({
      lowerInclusive: band.lowerInclusive === null ? null : String(band.lowerInclusive),
      upperExclusive: band.upperExclusive === null ? null : String(band.upperExclusive),
      outcomeIndex: band.outcomeIndex,
    })))
  ) {
    throw new Error(`Existing Slip market ${market.address} does not match Tissue rulebook for ${fixtureId}`);
  }
}
