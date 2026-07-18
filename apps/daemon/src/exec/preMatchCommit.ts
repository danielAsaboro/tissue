import type { Network, TissueMarketPrice } from "@tissue/shared";
import { hashPayload } from "../ledger/hash.js";
import { submitMemo } from "./memoAnchor.js";

/**
 * Pre-Match Hash Commitment ("Proof of Edge"). Before any in-play score message has been
 * folded into match state, Tissue's opening priced markets are exactly the desk's fair-value
 * distribution built from the pre-match consensus — this hashes and anchors that snapshot so
 * the grade sheet can later prove the model was committed BEFORE kickoff, not fit
 * retroactively.
 *
 * The sponsor's on-chain program (txoracle) has no instruction for Tissue to write its own
 * arbitrary data — it is a data-oracle/validation program for TxLINE's own roots, not a
 * generic commitment registry (GROUND-TRUTH.md T1). Anchoring uses Solana's standard SPL
 * Memo program instead: a real, confirmed devnet transaction whose memo is the commitment
 * hash, block-timed by the chain itself. This is not a new program deployment, not a
 * simulated proof — it is the standard, well-known technique for on-chain timestamping.
 * The tx-submission mechanics are shared with periodic checkpoint anchoring (see
 * exec/periodicAnchor.ts) via exec/memoAnchor.ts.
 */

export interface PreMatchCommitment {
  readonly fixtureId: string;
  /** Feed ts of the message whose repricing produced this snapshot (never wall-clock). */
  readonly ts: number;
  readonly hash: string;
  readonly markets: readonly TissueMarketPrice[];
}

/**
 * Deterministic, offline. Same "prepare vs live" split as exec/anchor.ts::prepareOddsAnchor —
 * this never claims a transaction was submitted; live submission is submitPreMatchCommitment.
 */
export function preparePreMatchCommitment(
  fixtureId: string,
  ts: number,
  markets: readonly TissueMarketPrice[],
): PreMatchCommitment {
  const hash = hashPayload({ fixtureId, ts, markets });
  return { fixtureId, ts, hash, markets };
}

export type PreMatchCommitmentStatus = "confirmed" | "failed";

export interface PreMatchCommitmentEvidence extends PreMatchCommitment {
  readonly network: Network;
  readonly status: PreMatchCommitmentStatus;
  readonly submittedAt: number;
  readonly txSig?: string;
  readonly slot?: number;
  readonly error?: string;
}

export interface PreMatchCommitmentOptions {
  readonly rpcUrl: string;
  readonly network: Network;
  readonly keypairPath: string | undefined;
}

/**
 * Submit the commitment hash as an SPL Memo transaction on the configured network and wait
 * for confirmation. Real signature, real slot, real confirmed-commitment check — the same
 * evidence discipline as validate_odds anchoring (anchorLive.ts).
 */
export async function submitPreMatchCommitment(
  commitment: PreMatchCommitment,
  opts: PreMatchCommitmentOptions,
): Promise<PreMatchCommitmentEvidence> {
  const base = { ...commitment, network: opts.network };
  const result = await submitMemo(`tissue-pre-match-commit:${commitment.hash}`, opts);
  return { ...base, ...result };
}
