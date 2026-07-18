import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { isConfirmedSignature, loadKeypair } from "./anchorLive.js";

/**
 * Shared SPL Memo submission — the same real, confirmed on-chain timestamping technique used
 * by the Pre-Match Commitment (see preMatchCommit.ts for why: the sponsor's txoracle program
 * has no generic commitment instruction). Factored out so any future memo-anchored evidence
 * (checkpoint roots, signed policy snapshots, ...) shares one tested tx-submission path
 * instead of re-implementing blockhash/sign/send/confirm each time.
 */

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface MemoSubmitOptions {
  readonly rpcUrl: string;
  readonly keypairPath: string | undefined;
}

export interface MemoSubmitResult {
  readonly status: "confirmed" | "failed";
  readonly submittedAt: number;
  readonly txSig?: string;
  readonly slot?: number;
  readonly error?: string;
}

export async function submitMemo(memoText: string, opts: MemoSubmitOptions): Promise<MemoSubmitResult> {
  const submittedAt = Date.now();
  try {
    const payer = loadKeypair(opts.keypairPath, true);
    const connection = new Connection(opts.rpcUrl, "confirmed");
    const ix = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoText, "utf8"),
    });
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    const txSig = await connection.sendRawTransaction(tx.serialize());
    const confirmed = await connection.confirmTransaction(
      { signature: txSig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmed.value.err) {
      return { status: "failed", submittedAt, error: `memo tx failed: ${JSON.stringify(confirmed.value.err)}` };
    }
    const status = await connection.getSignatureStatus(txSig, { searchTransactionHistory: true });
    return {
      status: isConfirmedSignature(status.value) ? "confirmed" : "failed",
      submittedAt,
      txSig,
      ...(status.value?.slot !== undefined ? { slot: status.value.slot } : {}),
    };
  } catch (error) {
    return { status: "failed", submittedAt, error: error instanceof Error ? error.message : String(error) };
  }
}
