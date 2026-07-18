import { ed25519 } from "@noble/curves/ed25519.js";

/**
 * Browser-safe port of the daemon's exact hash construction
 * (apps/daemon/src/ledger/hash.ts, apps/daemon/src/ledger/merkle.ts). Runs in the visitor's
 * own browser via WebCrypto — byte-for-byte the same algorithm the daemon uses, so a match
 * here is real independent confirmation, not a restated assertion. This file must stay in
 * lockstep with the daemon's canonicalize/linkHash/verifyMerkleProof — it intentionally
 * duplicates rather than imports them, since browser code cannot import node:crypto.
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 decoder (Bitcoin/Solana alphabet) — a Solana pubkey is always 32 bytes. */
export function base58Decode(input: string): Uint8Array {
  let num = 0n;
  for (const ch of input) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Matches ledger/signing.ts::signHash exactly: Ed25519 over the UTF-8 bytes of the hex hash
 *  string (not the raw hash bytes) — verify with the same convention. */
export function verifyDecisionSignature(hashHex: string, signatureHex: string, signerPubkeyBase58: string): boolean {
  try {
    const message = new TextEncoder().encode(hashHex);
    const signature = hexToBytes(signatureHex);
    const publicKey = base58Decode(signerPubkeyBase58);
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortDeep(obj[k]);
    return out;
  }
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** H(prevHash '|' canonical(recordWithoutHash)) — must match ledger/hash.ts::linkHash exactly. */
export async function linkHash(prevHash: string, recordWithoutHash: unknown): Promise<string> {
  return sha256Hex(prevHash + "|" + canonicalize(recordWithoutHash));
}

export interface MerkleProofNode {
  readonly hash: string;
  readonly isRightSibling: boolean;
}

/** Must match ledger/merkle.ts::verifyMerkleProof exactly (same SHA-256 pair-hash, same
 *  left/right ordering convention). */
export async function verifyMerkleProof(
  leaf: string,
  proof: readonly MerkleProofNode[],
  root: string,
): Promise<boolean> {
  let current = leaf;
  for (const node of proof) {
    current = node.isRightSibling
      ? await sha256Hex(current + node.hash)
      : await sha256Hex(node.hash + current);
  }
  return current === root;
}

/**
 * Recompute a Tissue decision record's hash exactly as the daemon does: strip
 * hash/signature/signerPubkey, then linkHash(prevHash, rest). Matches the /record export's
 * documented howToVerify procedure and ledger/ledger.ts::Ledger.append /
 * ledger/ledger.ts::verifyChain.
 */
export async function recomputeDecisionHash(record: Record<string, unknown>): Promise<string> {
  const { hash: _hash, signature: _signature, signerPubkey: _signerPubkey, ...rest } = record;
  void _hash;
  void _signature;
  void _signerPubkey;
  const prevHash = String(record.prevHash ?? "");
  return linkHash(prevHash, rest);
}
