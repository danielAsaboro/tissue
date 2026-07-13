import { PublicKey } from "@solana/web3.js";
import type { Network } from "@tissue/shared";

/**
 * REAL provenance anchoring via the sponsor's `validate_odds` CPI (PRD §1.5, GROUND-TRUTH T3).
 * This is the pillar of "the backtest can't lie" that is genuinely on-chain today — separate
 * from (and unaffected by) the simulated matching book.
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
const MS_PER_DAY = 86_400_000;

/** epochDay from a feed timestamp (ms). MUST come from the proof's own ts, never Date.now(). */
export function epochDayFromTs(tsMs: number): number {
  return Math.floor(tsMs / MS_PER_DAY);
}

function u16le(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
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

export interface PreparedAnchor {
  readonly network: Network;
  readonly epochDay: number;
  readonly rootPda: string;
  readonly programId: string;
  /** True once the live validate_odds submission path is exercised (needs proof endpoint). */
  readonly submitted: boolean;
  readonly note: string;
}

/**
 * Prepare a validate_odds anchor for an odds record at feed time `tsMs`. Deterministic and
 * offline; records the exact on-chain account that WOULD verify this record's inclusion.
 * The ledger stores this as provenance metadata for every sampled decision.
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
    note: "validate_odds prepared; live submit pending odds-proof REST endpoint (GROUND-TRUTH T3)",
  };
}
