import type { Network } from "@tissue/shared";
import { hashPayload } from "../ledger/hash.js";
import { buildMerkleTree } from "../ledger/merkle.js";
import { submitMemo } from "./memoAnchor.js";

/**
 * Periodic on-chain checkpoint anchoring. The Pre-Match Commitment (preMatchCommit.ts)
 * proves the desk's opening fair-value snapshot was committed before kickoff — real evidence,
 * but a single point in time. This extends the same SPL Memo technique to anchor a Merkle
 * root over every record hash from genesis through this checkpoint, at regular intervals
 * through the match — so a judge (or anyone) can find multiple independent on-chain
 * timestamps AND get an O(log n) inclusion proof for any specific past decision (see
 * ledger/merkle.ts, api/server.ts `/ledger/proof`), not just a final "trust the JSONL" claim.
 */

export interface CheckpointCommitment {
  readonly fixtureId: string;
  readonly seq: number;
  readonly merkleRoot: string;
  readonly hash: string;
}

/**
 * Deterministic, offline — same "prepare vs submit" split as preMatchCommit.ts.
 * `recordHashes` are the ledger's `record.hash` values for seq 0..seq inclusive (leaves),
 * in order — the caller (LiveDesk) owns slicing the authoritative ledger.
 */
export function prepareCheckpointAnchor(fixtureId: string, seq: number, recordHashes: readonly string[]): CheckpointCommitment {
  const merkleRoot = buildMerkleTree(recordHashes).root;
  return { fixtureId, seq, merkleRoot, hash: hashPayload({ fixtureId, seq, merkleRoot }) };
}

/**
 * Pure — decides whether a new checkpoint is due. Interval is measured in decisions (ledger
 * length), not wall-clock time, so it stays deterministic and testable without timers.
 */
export function isCheckpointDue(currentSeq: number, lastAnchoredSeq: number | null, intervalDecisions: number): boolean {
  if (intervalDecisions <= 0) return false;
  if (lastAnchoredSeq === null) return currentSeq >= intervalDecisions;
  return currentSeq - lastAnchoredSeq >= intervalDecisions;
}

export type CheckpointAnchorStatus = "confirmed" | "failed";

export interface CheckpointAnchorEvidence extends CheckpointCommitment {
  readonly network: Network;
  readonly status: CheckpointAnchorStatus;
  readonly submittedAt: number;
  readonly txSig?: string;
  readonly slot?: number;
  readonly error?: string;
}

export interface CheckpointAnchorOptions {
  readonly rpcUrl: string;
  readonly network: Network;
  readonly keypairPath: string | undefined;
}

export async function submitCheckpointAnchor(
  commitment: CheckpointCommitment,
  opts: CheckpointAnchorOptions,
): Promise<CheckpointAnchorEvidence> {
  const base = { ...commitment, network: opts.network };
  const result = await submitMemo(`tissue-checkpoint:${commitment.seq}:${commitment.hash}`, opts);
  return { ...base, ...result };
}
