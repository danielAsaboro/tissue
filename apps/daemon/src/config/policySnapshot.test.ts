import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { loadPolicy } from "./policy.js";
import { hashPolicy, loadLastPolicySnapshot, recordPolicySnapshot } from "./policySnapshot.js";
import { signHash, verifyHashSignature, type LedgerSigner } from "../ledger/signing.js";

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tissue-policy-snapshot-"));
  return join(dir, "policy-snapshots.jsonl");
}

function signerFrom(keypair: Keypair): LedgerSigner {
  return { publicKey: keypair.publicKey.toBase58(), sign: (h) => signHash(h, keypair.secretKey) };
}

describe("hashPolicy — deterministic over the canonical policy object", () => {
  it("produces the same hash for the same loaded policy every time", () => {
    const policy = loadPolicy();
    expect(hashPolicy(policy)).toBe(hashPolicy(policy));
  });

  it("changes when any field of the policy differs", () => {
    const policy = loadPolicy();
    const mutated = { ...policy, sizing: { ...policy.sizing, kelly_fraction: policy.sizing.kelly_fraction + 0.01 } };
    expect(hashPolicy(mutated)).not.toBe(hashPolicy(policy));
  });
});

describe("recordPolicySnapshot — appends only when the policy actually changed, signs when a signer is given", () => {
  it("appends a first entry when none exists yet", () => {
    const path = tempPath();
    const policy = loadPolicy();
    const entry = recordPolicySnapshot(policy, path, undefined);
    expect(entry).toBeDefined();
    expect(entry!.policyHash).toBe(hashPolicy(policy));
    expect(entry!.signature).toBeUndefined();
    expect(loadLastPolicySnapshot(path)!.policyHash).toBe(entry!.policyHash);
  });

  it("does not append a duplicate entry when the policy is unchanged since the last boot", () => {
    const path = tempPath();
    const policy = loadPolicy();
    recordPolicySnapshot(policy, path, undefined);
    const second = recordPolicySnapshot(policy, path, undefined);
    expect(second).toBeUndefined();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("appends a new entry when the policy changes between boots", () => {
    const path = tempPath();
    const policy = loadPolicy();
    recordPolicySnapshot(policy, path, undefined);
    const mutated = { ...policy, sizing: { ...policy.sizing, kelly_fraction: policy.sizing.kelly_fraction + 0.01 } };
    const second = recordPolicySnapshot(mutated, path, undefined);
    expect(second).toBeDefined();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("signs the entry with the given signer, independently verifiable", () => {
    const path = tempPath();
    const keypair = Keypair.generate();
    const signer = signerFrom(keypair);
    const policy = loadPolicy();
    const entry = recordPolicySnapshot(policy, path, signer);
    expect(entry!.signerPubkey).toBe(signer.publicKey);
    expect(verifyHashSignature(entry!.policyHash, entry!.signature!, entry!.signerPubkey!)).toBe(true);
  });
});
