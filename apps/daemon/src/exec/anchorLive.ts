import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import type { Network, OddsMessage } from "@tissue/shared";
import { marketKeyString } from "@tissue/shared";
import type { AuthCredentials } from "../ingest/txlineAuth.js";
import { authHeaders } from "../ingest/txlineAuth.js";
import { normalizeOdds } from "../ingest/normalize.js";
import { deriveDailyOddsRootPda, PROGRAM_ID } from "./anchor.js";

const cwdIdlPath = resolve(process.cwd(), "apps/daemon/idls/txoracle.json");
const IDL_PATH = process.env.TISSUE_IDL_PATH
  ?? (existsSync(cwdIdlPath) ? cwdIdlPath : fileURLToPath(new URL("../../idls/txoracle.json", import.meta.url)));

export type AnchorMode = "view" | "transaction";
export type AnchorStatus = "verified" | "confirmed" | "rejected" | "failed";

export interface AnchorEvidence {
  readonly fixtureId: string;
  readonly messageId: string;
  readonly ts: number;
  readonly network: Network;
  readonly method: AnchorMode;
  readonly status: AnchorStatus;
  readonly programId: string;
  readonly rootPda: string;
  readonly verifiedAt: number;
  readonly result: boolean;
  readonly txSig?: string;
  readonly slot?: number;
  readonly error?: string;
}

export interface OddsAnchorOptions {
  readonly origin: string;
  readonly rpcUrl: string;
  readonly network: Network;
  readonly credentials: AuthCredentials;
  readonly mode: AnchorMode;
  readonly keypairPath?: string;
}

interface SignatureEvidence {
  readonly err: unknown;
  readonly slot: number;
  readonly confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
}

export function isConfirmedSignature(value: SignatureEvidence | null): boolean {
  return value !== null
    && value.err === null
    && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized");
}

export interface ProofNodeResponse {
  readonly hash: string | readonly number[];
  readonly isRightSibling: boolean;
}

export interface OddsProofResponse {
  readonly odds: Record<string, unknown>;
  readonly summary: {
    readonly fixtureId: number | string;
    readonly updateStats: {
      readonly updateCount: number;
      readonly minTimestamp: number | string;
      readonly maxTimestamp: number | string;
    };
    readonly oddsSubTreeRoot: string | readonly number[];
  };
  readonly subTreeProof: readonly ProofNodeResponse[];
  readonly mainTreeProof: readonly ProofNodeResponse[];
}

function value<T>(record: Record<string, unknown>, ...keys: string[]): T {
  for (const key of keys) {
    const found = record[key];
    if (found !== undefined && found !== null) return found as T;
  }
  throw new Error(`odds proof response missing ${keys.join("/")}`);
}

export function toBytes32(input: string | readonly number[]): number[] {
  let bytes: Uint8Array;
  if (Array.isArray(input)) {
    if (input.length !== 32 || input.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error("Merkle byte arrays must contain exactly 32 integers from 0 through 255");
    }
    bytes = Uint8Array.from(input);
  } else {
    const encoded = input as string;
    if (encoded.startsWith("0x")) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(encoded)) throw new Error("Merkle hex hashes must contain exactly 64 hexadecimal characters");
      bytes = Buffer.from(encoded.slice(2), "hex");
    } else {
      if (!/^[A-Za-z0-9+/]{43}=?$/.test(encoded)) {
        throw new Error("Merkle hashes must be canonical 32-byte base64 or 0x-prefixed hex");
      }
      bytes = Buffer.from(encoded, "base64");
    }
  }
  if (bytes.length !== 32) throw new Error(`expected a 32-byte Merkle hash, received ${bytes.length}`);
  return Array.from(bytes);
}

export function proofNodes(nodes: readonly ProofNodeResponse[]): { hash: number[]; isRightSibling: boolean }[] {
  if (!Array.isArray(nodes)) throw new Error("Merkle proof nodes must be an array");
  return nodes.map((node) => {
    if (typeof node?.isRightSibling !== "boolean") throw new Error("proof node isRightSibling must be boolean");
    return { hash: toBytes32(node.hash), isRightSibling: node.isRightSibling };
  });
}

export function assertProofMatchesMessage(
  message: OddsMessage,
  proof: OddsProofResponse,
  network: Network,
): number {
  const proofMessage = normalizeOdds(proof.odds, network);
  if (!proofMessage) throw new Error("TxLINE proof odds record cannot be normalized as a supported complete market");
  if (proofMessage.msgId !== message.msgId) throw new Error("TxLINE proof returned a different odds message ID");
  if (proofMessage.fixtureId !== message.fixtureId) throw new Error("TxLINE proof returned a different fixture ID");
  if (proofMessage.ts !== message.ts) throw new Error("TxLINE proof returned a different feed timestamp");
  if (marketKeyString(proofMessage.marketKey) !== marketKeyString(message.marketKey)) {
    throw new Error("TxLINE proof returned a different market");
  }
  if (proofMessage.inRunning !== message.inRunning) throw new Error("TxLINE proof returned a different in-running state");
  if ((proofMessage.bookmaker ?? null) !== (message.bookmaker ?? null)) throw new Error("TxLINE proof returned a different bookmaker");
  if ((proofMessage.bookmakerId ?? null) !== (message.bookmakerId ?? null)) throw new Error("TxLINE proof returned a different bookmaker ID");
  const proofPrices = Object.entries(proofMessage.rawOdds ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const streamPrices = Object.entries(message.rawOdds ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(proofPrices) !== JSON.stringify(streamPrices)) {
    throw new Error("TxLINE proof prices do not match the streamed odds record");
  }
  const summaryFixture = String(proof.summary.fixtureId);
  if (summaryFixture !== message.fixtureId) throw new Error("TxLINE proof summary returned a different fixture ID");
  const minTs = Number(proof.summary.updateStats.minTimestamp);
  const maxTs = Number(proof.summary.updateStats.maxTimestamp);
  if (!Number.isSafeInteger(minTs) || !Number.isSafeInteger(maxTs) || proofMessage.ts < minTs || proofMessage.ts > maxTs) {
    throw new Error("TxLINE proof timestamp is outside its batch summary range");
  }
  if (!Number.isSafeInteger(proof.summary.updateStats.updateCount) || proof.summary.updateStats.updateCount < 1) {
    throw new Error("TxLINE proof summary updateCount must be a positive integer");
  }
  return proofMessage.ts;
}

export function loadKeypair(path: string | undefined, required: boolean): Keypair {
  if (!path) {
    if (required) throw new Error("TISSUE_KEYPAIR_PATH is required for transaction anchoring");
    return Keypair.generate();
  }
  const resolved = path.replace(/^~/, homedir());
  if (!existsSync(resolved)) throw new Error(`Solana keypair not found: ${resolved}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, "utf8")) as number[]));
}

async function fetchProof(message: OddsMessage, opts: OddsAnchorOptions): Promise<OddsProofResponse> {
  const url = new URL("/api/odds/validation", opts.origin);
  url.searchParams.set("messageId", message.msgId);
  url.searchParams.set("ts", String(message.ts));
  const response = await fetch(url, {
    headers: authHeaders(opts.credentials),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`TxLINE odds proof ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as OddsProofResponse;
}

function anchorOdds(record: Record<string, unknown>): Record<string, unknown> {
  const optional = <T>(...keys: string[]): T | null => {
    try { return value<T>(record, ...keys); } catch { return null; }
  };
  return {
    fixtureId: new anchor.BN(value<number | string>(record, "FixtureId", "fixtureId", "fixture_id")),
    messageId: value<string>(record, "MessageId", "messageId", "message_id"),
    ts: new anchor.BN(value<number | string>(record, "Ts", "ts")),
    bookmaker: value<string>(record, "Bookmaker", "bookmaker"),
    bookmakerId: value<number>(record, "BookmakerId", "bookmakerId", "bookmaker_id"),
    superOddsType: value<string>(record, "SuperOddsType", "superOddsType", "super_odds_type"),
    gameState: optional<string>("GameState", "gameState", "game_state"),
    inRunning: value<boolean>(record, "InRunning", "inRunning", "in_running"),
    marketParameters: optional<string>("MarketParameters", "marketParameters", "market_parameters"),
    marketPeriod: optional<string>("MarketPeriod", "marketPeriod", "market_period"),
    priceNames: value<string[]>(record, "PriceNames", "priceNames", "price_names"),
    prices: value<number[]>(record, "Prices", "prices"),
  };
}

export async function verifyOddsOnChain(
  message: OddsMessage,
  opts: OddsAnchorOptions,
): Promise<AnchorEvidence> {
  const base = {
    fixtureId: message.fixtureId,
    messageId: message.msgId,
    ts: message.ts,
    network: opts.network,
    method: opts.mode,
    programId: PROGRAM_ID[opts.network].toBase58(),
  } as const;
  let rootPda = "";
  try {
    const proof = await fetchProof(message, opts);
    const proofTs = assertProofMatchesMessage(message, proof, opts.network);
    const epochDay = Math.floor(proofTs / 86_400_000);
    const derived = deriveDailyOddsRootPda(opts.network, epochDay);
    rootPda = derived.pda.toBase58();
    const payer = loadKeypair(opts.keypairPath, opts.mode === "transaction");
    const connection = new Connection(opts.rpcUrl, "confirmed");
    const account = await connection.getAccountInfo(derived.pda, "confirmed");
    if (!account) throw new Error(`daily odds root PDA does not exist on ${opts.network}: ${rootPda}`);
    if (!account.owner.equals(PROGRAM_ID[opts.network])) {
      throw new Error(`daily odds root PDA is owned by ${account.owner.toBase58()}, not TxLINE`);
    }
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const program = new anchor.Program(idl, provider);
    if (!program.programId.equals(PROGRAM_ID[opts.network])) {
      throw new Error(`IDL program ${program.programId.toBase58()} does not match configured TxLINE program`);
    }
    const summary = {
      fixtureId: new anchor.BN(proof.summary.fixtureId),
      updateStats: {
        updateCount: proof.summary.updateStats.updateCount,
        minTimestamp: new anchor.BN(proof.summary.updateStats.minTimestamp),
        maxTimestamp: new anchor.BN(proof.summary.updateStats.maxTimestamp),
      },
      oddsSubTreeRoot: toBytes32(proof.summary.oddsSubTreeRoot),
    };
    const validationMethod = () => program.methods
      .validateOdds!(
        new anchor.BN(proofTs),
        anchorOdds(proof.odds),
        summary,
        proofNodes(proof.subTreeProof),
        proofNodes(proof.mainTreeProof),
      )
      .accounts({ dailyOddsMerkleRoots: derived.pda });
    const result = await validationMethod().view();
    if (result !== true) {
      return { ...base, rootPda, verifiedAt: Date.now(), status: "rejected", result: false };
    }
    if (opts.mode === "view") {
      return { ...base, rootPda, verifiedAt: Date.now(), status: "verified", result: true };
    }
    const txSig = await validationMethod().rpc();
    const committed = await connection.confirmTransaction(txSig, "confirmed");
    if (committed.value.err) throw new Error(`validate_odds transaction failed: ${JSON.stringify(committed.value.err)}`);
    const confirmation = await connection.getSignatureStatus(txSig, { searchTransactionHistory: true });
    const slot = confirmation.value?.slot;
    const confirmed = isConfirmedSignature(confirmation.value);
    return {
      ...base,
      rootPda,
      verifiedAt: Date.now(),
      status: confirmed ? "confirmed" : "failed",
      result: confirmed,
      txSig,
      ...(slot !== undefined ? { slot } : {}),
      ...(!confirmed ? {
        error: confirmation.value?.err
          ? JSON.stringify(confirmation.value.err)
          : "transaction signature was not available at confirmed commitment",
      } : {}),
    };
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
