import { Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { loadKeypair } from "../exec/anchorLive.js";

/**
 * Ed25519 record signing (PRD extension: authenticity, not just tamper-evidence).
 * The hash chain (ledger/hash.ts) already proves no record was altered after the fact —
 * that is a property of the chain, checkable without knowing who produced it. It does not
 * prove the records came from a specific operator keypair. Signing each record's hash with
 * the same keypair already used for on-chain anchoring (exec/anchorLive.ts::loadKeypair)
 * adds that missing property: anyone with the public key can verify authorship independent
 * of trusting the daemon process that emitted the JSONL file.
 *
 * Ed25519 signatures are deterministic (RFC 8032 §5.1.6 derives the nonce from the private
 * key and message, no randomness) so this never breaks replay(corpus) === ledger.
 */

export interface LedgerSigner {
  readonly publicKey: string;
  sign(hashHex: string): string;
}

/** Loads the same keypair used for on-chain anchoring; undefined if none is configured. */
export function loadLedgerSigner(keypairPath: string | undefined): LedgerSigner | undefined {
  if (!keypairPath) return undefined;
  const keypair: Keypair = loadKeypair(keypairPath, true);
  return {
    publicKey: keypair.publicKey.toBase58(),
    sign: (hashHex: string) => signHash(hashHex, keypair.secretKey),
  };
}

export function signHash(hashHex: string, secretKey: Uint8Array): string {
  const signature = nacl.sign.detached(Buffer.from(hashHex, "utf8"), secretKey);
  return Buffer.from(signature).toString("hex");
}

export function verifyHashSignature(hashHex: string, signatureHex: string, publicKeyBase58: string): boolean {
  return nacl.sign.detached.verify(
    Buffer.from(hashHex, "utf8"),
    Buffer.from(signatureHex, "hex"),
    new PublicKey(publicKeyBase58).toBytes(),
  );
}
