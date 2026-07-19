import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair } from "@solana/web3.js";
import type { Network, ScoreMessage } from "@tissue/shared";
import type { AuthCredentials } from "../ingest/txlineAuth.js";
import { authHeaders } from "../ingest/txlineAuth.js";
import { STAT_KEY } from "../ingest/soccerFeed.js";
import { deriveDailyScoresRootPda, PROGRAM_ID } from "./anchor.js";
import {
  type AnchorEvidence,
  booleanProgramReturn,
  anchorErrorDetail,
  type ProofNodeResponse,
  proofNodes,
  toBytes32,
} from "./anchorLive.js";
import { loadTxlineIdl } from "./txlineIdl.js";

export interface ScoreAnchorOptions {
  readonly origin: string;
  readonly rpcUrl: string;
  readonly network: Network;
  readonly credentials: AuthCredentials;
}

export interface ScoreStatProofResponse {
  readonly statToProve: { readonly key: number; readonly value: number; readonly period: number };
  readonly eventStatRoot: string | readonly number[];
  readonly statProof: readonly ProofNodeResponse[];
  readonly subTreeProof: readonly ProofNodeResponse[];
  readonly mainTreeProof: readonly ProofNodeResponse[];
  readonly summary: {
    readonly fixtureId: number | string;
    readonly updateStats: {
      readonly updateCount: number;
      readonly minTimestamp: number | string;
      readonly maxTimestamp: number | string;
    };
    readonly eventStatsSubTreeRoot: string | readonly number[];
  };
}

const EXPECTED_STATS = [
  [STAT_KEY.P1_GOALS, "homeScore"],
  [STAT_KEY.P2_GOALS, "awayScore"],
  [STAT_KEY.P1_RED, "homeReds"],
  [STAT_KEY.P2_RED, "awayReds"],
] as const;

function safeInteger(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

export function assertScoreProofMatchesMessage(
  message: ScoreMessage,
  proof: ScoreStatProofResponse,
  statKey: number,
  expectedValue: number,
): { proofTs: number; period: number } {
  if (String(proof.summary?.fixtureId) !== message.fixtureId) {
    throw new Error("TxLINE score proof returned a different fixture ID");
  }
  const updateCount = safeInteger(proof.summary.updateStats.updateCount, "score proof updateCount");
  if (updateCount < 1) throw new Error("score proof updateCount must be positive");
  const minTs = safeInteger(proof.summary.updateStats.minTimestamp, "score proof minimum timestamp");
  const maxTs = safeInteger(proof.summary.updateStats.maxTimestamp, "score proof maximum timestamp");
  if (minTs < 0 || maxTs < minTs || message.ts < minTs || message.ts > maxTs) {
    throw new Error("streamed score timestamp is outside its anchored batch range");
  }
  const key = safeInteger(proof.statToProve?.key, "score proof stat key");
  const value = safeInteger(proof.statToProve?.value, "score proof stat value");
  const period = safeInteger(proof.statToProve?.period, "score proof period");
  if (key !== statKey) throw new Error(`TxLINE score proof returned stat key ${key}, expected ${statKey}`);
  if (value !== expectedValue) {
    throw new Error(`TxLINE score proof value ${value} does not match streamed value ${expectedValue} for key ${statKey}`);
  }
  const streamedPeriod = Number(message.phase);
  if (Number.isSafeInteger(streamedPeriod) && streamedPeriod !== 0 && period !== streamedPeriod) {
    throw new Error(`TxLINE score proof period ${period} does not match streamed phase ${streamedPeriod}`);
  }
  toBytes32(proof.eventStatRoot);
  toBytes32(proof.summary.eventStatsSubTreeRoot);
  proofNodes(proof.statProof);
  proofNodes(proof.subTreeProof);
  proofNodes(proof.mainTreeProof);
  return { proofTs: minTs, period };
}

async function fetchStatProof(
  message: ScoreMessage,
  statKey: number,
  opts: ScoreAnchorOptions,
): Promise<ScoreStatProofResponse> {
  if (!Number.isSafeInteger(message.sourceSeq) || message.sourceSeq! < 1) {
    throw new Error(`score message ${message.msgId} has no positive TxLINE sequence`);
  }
  const url = new URL("/api/scores/stat-validation", opts.origin);
  url.searchParams.set("fixtureId", message.fixtureId);
  url.searchParams.set("seq", String(message.sourceSeq));
  url.searchParams.set("statKey", String(statKey));
  const response = await fetch(url, {
    headers: authHeaders(opts.credentials),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`TxLINE score proof ${response.status}: ${await response.text()}`);
  return (await response.json()) as ScoreStatProofResponse;
}

export interface SlipResolutionProof {
  readonly dailyScoresRoots: string;
  readonly proof: {
    readonly eventStatRoot: Uint8Array;
    readonly statA: { readonly stat: ScoreStatProofResponse["statToProve"]; readonly statProof: Array<{ readonly hash: Uint8Array; readonly isRightSibling: boolean }> };
    readonly statB: { readonly stat: ScoreStatProofResponse["statToProve"]; readonly statProof: Array<{ readonly hash: Uint8Array; readonly isRightSibling: boolean }> };
    readonly summary: {
      readonly fixtureId: bigint;
      readonly updateCount: number;
      readonly minTimestamp: bigint;
      readonly maxTimestamp: bigint;
      readonly eventsSubTreeRoot: Uint8Array;
    };
    readonly subTreeProof: Array<{ readonly hash: Uint8Array; readonly isRightSibling: boolean }>;
    readonly mainTreeProof: Array<{ readonly hash: Uint8Array; readonly isRightSibling: boolean }>;
  };
}

/** Build the exact two-stat proof consumed by Slip's terminal soccer rulebooks. This reuses
 * the same TxLINE proof endpoint and strict fixture/value/period checks as live admission. */
export async function fetchSlipResolutionProof(
  message: ScoreMessage,
  opts: ScoreAnchorOptions,
): Promise<SlipResolutionProof> {
  if (!message.isFinal) throw new Error(`fixture ${message.fixtureId} is not final; refusing Slip resolution`);
  const home = await fetchStatProof(message, STAT_KEY.P1_GOALS, opts);
  const away = await fetchStatProof(message, STAT_KEY.P2_GOALS, opts);
  const homeValidated = assertScoreProofMatchesMessage(message, home, STAT_KEY.P1_GOALS, message.homeScore);
  const awayValidated = assertScoreProofMatchesMessage(message, away, STAT_KEY.P2_GOALS, message.awayScore);
  if (homeValidated.proofTs !== awayValidated.proofTs || homeValidated.period !== awayValidated.period) {
    throw new Error("TxLINE final score proofs do not describe the same anchored batch and period");
  }
  if (JSON.stringify(home.summary) !== JSON.stringify(away.summary)) {
    throw new Error("TxLINE final score proofs returned inconsistent batch summaries");
  }
  if (JSON.stringify(home.eventStatRoot) !== JSON.stringify(away.eventStatRoot)) {
    throw new Error("TxLINE final score proofs returned inconsistent event-stat roots");
  }
  const roots = deriveDailyScoresRootPda(opts.network, Math.floor(homeValidated.proofTs / 86_400_000));
  const binaryProofNodes = (nodes: readonly ProofNodeResponse[]) => proofNodes(nodes).map((node) => ({
    hash: Uint8Array.from(node.hash),
    isRightSibling: node.isRightSibling,
  }));
  return {
    dailyScoresRoots: roots.pda.toBase58(),
    proof: {
      eventStatRoot: Uint8Array.from(toBytes32(home.eventStatRoot)),
      statA: { stat: home.statToProve, statProof: binaryProofNodes(home.statProof) },
      statB: { stat: away.statToProve, statProof: binaryProofNodes(away.statProof) },
      summary: {
        fixtureId: BigInt(home.summary.fixtureId),
        updateCount: home.summary.updateStats.updateCount,
        minTimestamp: BigInt(home.summary.updateStats.minTimestamp),
        maxTimestamp: BigInt(home.summary.updateStats.maxTimestamp),
        eventsSubTreeRoot: Uint8Array.from(toBytes32(home.summary.eventStatsSubTreeRoot)),
      },
      subTreeProof: binaryProofNodes(home.subTreeProof),
      mainTreeProof: binaryProofNodes(home.mainTreeProof),
    },
  };
}

function anchorSummary(proof: ScoreStatProofResponse): Record<string, unknown> {
  return {
    fixtureId: new anchor.BN(proof.summary.fixtureId),
    updateStats: {
      updateCount: proof.summary.updateStats.updateCount,
      minTimestamp: new anchor.BN(proof.summary.updateStats.minTimestamp),
      maxTimestamp: new anchor.BN(proof.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(proof.summary.eventStatsSubTreeRoot),
  };
}

function anchorStat(proof: ScoreStatProofResponse): Record<string, unknown> {
  return {
    statToProve: proof.statToProve,
    eventStatRoot: toBytes32(proof.eventStatRoot),
    statProof: proofNodes(proof.statProof),
  };
}

export async function verifyScoreOnChain(
  message: ScoreMessage,
  opts: ScoreAnchorOptions,
): Promise<AnchorEvidence> {
  const base = {
    fixtureId: message.fixtureId,
    messageId: message.msgId,
    ts: message.ts,
    network: opts.network,
    method: "view" as const,
    programId: PROGRAM_ID[opts.network].toBase58(),
  };
  let rootPda = "";
  try {
    const proofs = await Promise.all(
      EXPECTED_STATS.map(([statKey]) => fetchStatProof(message, statKey, opts)),
    );
    const validated = proofs.map((proof, index) => {
      const [statKey, property] = EXPECTED_STATS[index]!;
      return assertScoreProofMatchesMessage(message, proof, statKey, message[property]);
    });
    const proofTs = validated[0]!.proofTs;
    const period = validated[0]!.period;
    for (let i = 1; i < proofs.length; i++) {
      if (validated[i]!.proofTs !== proofTs || validated[i]!.period !== period) {
        throw new Error("TxLINE score proofs do not describe the same anchored batch and period");
      }
      if (JSON.stringify(proofs[i]!.summary) !== JSON.stringify(proofs[0]!.summary)) {
        throw new Error("TxLINE score proofs returned inconsistent batch summaries");
      }
    }
    const epochDay = Math.floor(proofTs / 86_400_000);
    const derived = deriveDailyScoresRootPda(opts.network, epochDay);
    rootPda = derived.pda.toBase58();
    const connection = new Connection(opts.rpcUrl, "confirmed");
    const rootAccount = await connection.getAccountInfo(derived.pda, "confirmed");
    if (!rootAccount) throw new Error(`daily scores root PDA does not exist on ${opts.network}: ${rootPda}`);
    if (!rootAccount.owner.equals(PROGRAM_ID[opts.network])) {
      throw new Error(`daily scores root PDA is owned by ${rootAccount.owner.toBase58()}, not TxLINE`);
    }
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), {
      commitment: "confirmed",
    });
    const idl = loadTxlineIdl(opts.network);
    const program = new anchor.Program(idl, provider);
    if (!program.programId.equals(PROGRAM_ID[opts.network])) {
      throw new Error(`IDL program ${program.programId.toBase58()} does not match configured TxLINE program`);
    }
    for (const proof of proofs) {
      const simulation = await program.methods
        .validateStat!(
          new anchor.BN(proofTs),
          anchorSummary(proof),
          proofNodes(proof.subTreeProof),
          proofNodes(proof.mainTreeProof),
          { threshold: proof.statToProve.value, comparison: { equalTo: {} } },
          anchorStat(proof),
          null,
          null,
        )
        .accounts({ dailyScoresMerkleRoots: derived.pda })
        // Deep score trees regularly exceed Solana's 200k default even for a one-stat
        // proof. This raises the limit, not the fee/consumption; view remains read-only.
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .simulate();
      const result = booleanProgramReturn(simulation.raw ?? [], program.programId.toBase58());
      if (result !== true) {
        return { ...base, rootPda, verifiedAt: Date.now(), status: "rejected", result: false };
      }
    }
    return { ...base, rootPda, verifiedAt: Date.now(), status: "verified", result: true };
  } catch (error) {
    return {
      ...base,
      rootPda,
      verifiedAt: Date.now(),
      status: "failed",
      result: false,
      error: anchorErrorDetail(error),
    };
  }
}
