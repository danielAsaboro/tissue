import { PublicKey } from "@solana/web3.js";
import type { Network } from "@tissue/shared";

/**
 * Deterministic replay metadata for the sponsor's `validate_odds` CPI. This module performs
 * no network call and never claims verification; live proof retrieval and on-chain evidence
 * are implemented in `anchorLive.ts`.
 *
 * PDA derivation follows the documented Validation-Accounts table: seed `daily_batch_roots`
 * + epochDay as u16 LE. NOTE (flagged in GROUND-TRUTH): the IDL account is named
 * `daily_odds_merkle_roots` and emits no seeds; verify on-chain before relying on submission.
 * Submission also needs the odds proofs whose REST endpoint is not yet documented — so this
 * adapter derives + prepares deterministically now, and the live submit path lands when the
 * proof endpoint is confirmed.
 */

export const PROGRAM_ID: Record<Network, PublicKey> = {
  devnet: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
  mainnet: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
};

const DAILY_ODDS_ROOT_SEED = "daily_batch_roots";
const DAILY_SCORES_ROOT_SEED = "daily_scores_roots";
const MS_PER_DAY = 86_400_000;

/** epochDay from a feed timestamp (ms). MUST come from the proof's own ts, never Date.now(). */
export function epochDayFromTs(tsMs: number): number {
  if (!Number.isSafeInteger(tsMs) || tsMs < 0) {
    throw new Error(`feed timestamp must be a non-negative safe integer; received ${tsMs}`);
  }
  return Math.floor(tsMs / MS_PER_DAY);
}

function u16le(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`epoch day must fit in u16; received ${n}`);
  }
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

/** Derive the daily-odds-root PDA for a given epoch day (deterministic, offline). */
export function deriveDailyOddsRootPda(
  network: Network,
  epochDay: number,
): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(DAILY_ODDS_ROOT_SEED, "utf8"), u16le(epochDay)],
    PROGRAM_ID[network],
  );
  return { pda, bump };
}

/** Derive the daily score-stat root PDA documented by TxLINE. */
export function deriveDailyScoresRootPda(
  network: Network,
  epochDay: number,
): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(DAILY_SCORES_ROOT_SEED, "utf8"), u16le(epochDay)],
    PROGRAM_ID[network],
  );
  return { pda, bump };
}

export interface PreparedAnchor {
  readonly network: Network;
  readonly epochDay: number;
  readonly rootPda: string;
  readonly programId: string;
  /** Replay metadata is never submitted; live evidence lives in anchorLive.ts. */
  readonly submitted: boolean;
  readonly note: string;
}

/**
 * Prepare a validate_odds anchor for an odds record at feed time `tsMs`. Deterministic and
 * offline; records the exact on-chain account that would verify this record's inclusion.
 * It never claims that a proof was fetched or accepted.
 */
export function prepareOddsAnchor(network: Network, tsMs: number): PreparedAnchor {
  const epochDay = epochDayFromTs(tsMs);
  const { pda } = deriveDailyOddsRootPda(network, epochDay);
  return {
    network,
    epochDay,
    rootPda: pda.toBase58(),
    programId: PROGRAM_ID[network].toBase58(),
    submitted: false,
    note: "replay derivation only; no live verification claimed",
  };
}
