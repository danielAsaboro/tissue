import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { signHash, verifyHashSignature, type LedgerSigner } from "./signing.js";

function signerFrom(keypair: Keypair): LedgerSigner {
  return {
    publicKey: keypair.publicKey.toBase58(),
    sign: (hashHex: string) => signHash(hashHex, keypair.secretKey),
  };
}

describe("Ed25519 record signing — deterministic, verifiable independent of the signer", () => {
  it("produces the same signature for the same hash and keypair (RFC 8032 determinism)", () => {
    const keypair = Keypair.generate();
    const a = signHash("a".repeat(64), keypair.secretKey);
    const b = signHash("a".repeat(64), keypair.secretKey);
    expect(a).toBe(b);
  });

  it("verifies against the correct public key", () => {
    const keypair = Keypair.generate();
    const signer = signerFrom(keypair);
    const signature = signer.sign("b".repeat(64));
    expect(verifyHashSignature("b".repeat(64), signature, signer.publicKey)).toBe(true);
  });

  it("fails verification against a different public key", () => {
    const keypair = Keypair.generate();
    const impostor = Keypair.generate();
    const signature = signHash("c".repeat(64), keypair.secretKey);
    expect(verifyHashSignature("c".repeat(64), signature, impostor.publicKey.toBase58())).toBe(false);
  });

  it("fails verification when the signed hash is tampered with", () => {
    const keypair = Keypair.generate();
    const signer = signerFrom(keypair);
    const signature = signer.sign("d".repeat(64));
    expect(verifyHashSignature("e".repeat(64), signature, signer.publicKey)).toBe(false);
  });
});
