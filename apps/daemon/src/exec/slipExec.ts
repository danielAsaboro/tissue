import { createHash } from "node:crypto";
import { Connection, Transaction, TransactionInstruction, type Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { AccountRole, type Instruction } from "@solana/kit";
import { TissueSlipConsumer, type TissueSlipConfig } from "@tissue/slip";
import type { MarketKey, Selection } from "@tissue/shared";
import { isConfirmedSignature, loadKeypair } from "./anchorLive.js";

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

export interface SlipRulebookMapping {
  readonly expression: {
    readonly fixtureId: number;
    readonly settlementMode: "Terminal" | "FirstStatRace";
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

export interface SlipExecOptions {
  readonly rpcUrl: string;
  readonly keypairPath: string | undefined;
  readonly slipConfig: TissueSlipConfig;
  /** Milliseconds from now the market accepts stakes. Default 10 minutes. */
  readonly entryWindowMs?: number;
  /** Milliseconds from now the market can be resolved from a real score proof. Default 3 hours. */
  readonly resolveWindowMs?: number;
  /** Milliseconds from now the market can be voided/refunded if never resolved. Default +1 hour after resolve. */
  readonly voidWindowMs?: number;
}

export type SlipExecStatus = "confirmed" | "failed" | "rejected-by-gate";

export interface SlipExecutionEvidence {
  readonly fixtureId: string;
  /** The decision (ledger seq) whose intent this evidence traces back to. */
  readonly decisionSeq: number;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly edgeBps: number;
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
}

/**
 * Real Solana six-decimal amount (Slip's settlement mint convention — see packages/slip
 * consumer.ts formatAmount/parseAmount) from Tissue's own sizeUnits. 1 unit == 1.0 token.
 */
export function stakeUnitsToAmount(sizeUnits: number): bigint {
  return BigInt(Math.max(0, Math.round(sizeUnits * 1_000_000)));
}

/** The only fields executeSlipBuy actually needs — satisfied structurally by both a full
 *  QuoteProposal (replay/tests) and the ledger-derived candidates liveDesk builds from a
 *  DecisionRecord's already risk-approved Intents. */
export interface SlipTradeInput {
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly sizeUnits: number;
  readonly edgeBps: number;
}

/**
 * Turns one of Tissue's own risk-approved trading decisions into a real, signed, confirmed
 * Slip transaction: find-or-create the fixture's market for that MarketKey, then buy the
 * outcome band Tissue's edge favors. Every step submits a real transaction and waits for
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
    fixtureId,
    decisionSeq,
    marketKey: proposal.marketKey,
    selection: proposal.selection,
    edgeBps: proposal.edgeBps,
    sizeUnits: proposal.sizeUnits,
    outcomeIndex,
    stakeAmount: stakeAmount.toString(),
    submittedAt,
  };
  try {
    const payer = loadKeypair(opts.keypairPath, true);
    const connection = new Connection(opts.rpcUrl, "confirmed");
    const consumer = new TissueSlipConsumer(opts.slipConfig);
    const marketId = deriveSlipMarketId(fixtureId, proposal.marketKey);

    let market = await findExistingMarket(consumer, fixtureId, payer.publicKey.toBase58());
    let marketCreateTxSig: string | undefined;
    if (!market) {
      const now = Math.floor(Date.now() / 1000);
      const entryDeadline = now + Math.floor((opts.entryWindowMs ?? 600_000) / 1000);
      const resolveAt = now + Math.floor((opts.resolveWindowMs ?? 10_800_000) / 1000);
      const voidAt = resolveAt + Math.floor((opts.voidWindowMs ?? 3_600_000) / 1000);
      const prepared = await consumer.prepareCreateMarket({
        id: marketId,
        creator: payer.publicKey.toBase58(),
        rulebook: {
          version: 1,
          fixtureId,
          question: `Tissue ${proposal.marketKey.market} for fixture ${fixtureId}`,
          sentence: `Tissue-priced ${proposal.marketKey.market} market, mapped from TxLINE fixture ${fixtureId}.`,
          expression: mapping.expression,
          outcomeLabels: [...mapping.outcomeLabels],
          bands: mapping.bands.map((b) => ({ ...b })),
          entryDeadline,
          resolveAt,
          voidAt,
          feeBps: 0,
          tipBps: 0,
        },
      });
      if (!prepared.market) {
        return { ...base, status: "failed", error: "Slip create-market response did not include a market address" };
      }
      const createResult = await signAndSend(connection, prepared.instructions, payer);
      if (createResult.status !== "confirmed") {
        return { ...base, status: "failed", error: createResult.error ?? "market creation not confirmed" };
      }
      market = prepared.market;
      marketCreateTxSig = createResult.txSig;
    }

    const buyPrepared = await consumer.prepareBuy({
      market: market!,
      buyer: payer.publicKey.toBase58(),
      outcomeIndex,
      // prepareBuy's `amount` is a human decimal string (its own parseAmount scales by 1e6);
      // `stakeAmount` above is already the raw on-chain integer, so pass sizeUnits, not that.
      amount: proposal.sizeUnits.toString(),
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
        ...(marketCreateTxSig ? { marketCreateTxSig } : {}),
        error: buyResult.error ?? "buy not confirmed",
      };
    }
    return {
      ...base,
      status: "confirmed",
      market,
      ticket: buyPrepared.ticket,
      ...(marketCreateTxSig ? { marketCreateTxSig } : {}),
      ...(buyResult.txSig ? { buyTxSig: buyResult.txSig } : {}),
    };
  } catch (error) {
    return { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * marketId (deriveSlipMarketId) only fixes the PDA at create time; the SDK exposes no raw PDA
 * lookup, so the real existence check is listing the fixture's markets by creator.
 */
async function findExistingMarket(
  consumer: TissueSlipConsumer,
  fixtureId: string,
  creator: string,
): Promise<string | undefined> {
  try {
    const markets = await consumer.listMarkets({ fixtureId });
    return markets.find((m) => m.creator === creator)?.address;
  } catch {
    return undefined;
  }
}
