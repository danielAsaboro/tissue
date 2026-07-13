import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import type { Network, ScoreMessage } from "@tissue/shared";
import type { AuthCredentials } from "../ingest/txlineAuth.js";
import { authHeaders } from "../ingest/txlineAuth.js";
import { STAT_KEY } from "../ingest/soccerFeed.js";
import { deriveDailyScoresRootPda, PROGRAM_ID } from "./anchor.js";
import {
  type AnchorEvidence,
  type ProofNodeResponse,
  proofNodes,
  toBytes32,
} from "./anchorLive.js";

const cwdIdlPath = resolve(process.cwd(), "apps/daemon/idls/txoracle.json");
const IDL_PATH = process.env.TISSUE_IDL_PATH
  ?? (existsSync(cwdIdlPath) ? cwdIdlPath : fileURLToPath(new URL("../../idls/txoracle.json", import.meta.url)));

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
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const program = new anchor.Program(idl, provider);
    if (!program.programId.equals(PROGRAM_ID[opts.network])) {
      throw new Error(`IDL program ${program.programId.toBase58()} does not match configured TxLINE program`);
    }
    for (const proof of proofs) {
      const result = await program.methods
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
        .view();
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
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
