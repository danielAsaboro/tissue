import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashPayload } from "../ledger/hash.js";
import type { LedgerSigner } from "../ledger/signing.js";
import type { Policy } from "./policy.js";

/**
 * Signed policy config snapshots. `policy.toml` is the single source of truth for every
 * tunable constant in the system (PRD discipline: no magic numbers in logic) — but a JSONL
 * decision ledger only proves what the desk DID with whatever policy happened to be loaded.
 * It says nothing about which policy that was, or whether it changed between restarts. This
 * hashes the policy actually in effect at boot, signs it with the same operator keypair used
 * for ledger records (ledger/signing.ts), and appends it to a durable log only when it
 * differs from the last recorded snapshot — "what policy was live when" becomes independently
 * checkable evidence instead of an assumption backed only by git history.
 *
 * Hashed value is the canonical Policy OBJECT (ledger/hash.ts::hashPayload), not the raw TOML
 * bytes — comment/whitespace-only edits to policy.toml carry no behavioral meaning and
 * shouldn't create a spurious "policy changed" entry.
 */

export interface PolicySnapshotEntry {
  readonly recordedAt: number;
  readonly policyHash: string;
  readonly signature?: string;
  readonly signerPubkey?: string;
}

export function hashPolicy(policy: Policy): string {
  return hashPayload(policy);
}

export function loadAllPolicySnapshots(path: string): readonly PolicySnapshotEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PolicySnapshotEntry);
}

export function loadLastPolicySnapshot(path: string): PolicySnapshotEntry | undefined {
  const all = loadAllPolicySnapshots(path);
  return all.length > 0 ? all[all.length - 1] : undefined;
}

/**
 * Appends a new signed snapshot only when the policy's canonical hash differs from the last
 * recorded one (or none has ever been recorded) — returns the entry if one was appended,
 * undefined if the policy is unchanged since the last boot.
 */
export function recordPolicySnapshot(
  policy: Policy,
  path: string,
  signer: LedgerSigner | undefined,
): PolicySnapshotEntry | undefined {
  const policyHash = hashPolicy(policy);
  const last = loadLastPolicySnapshot(path);
  if (last && last.policyHash === policyHash) return undefined;
  const entry: PolicySnapshotEntry = {
    recordedAt: Date.now(),
    policyHash,
    ...(signer ? { signature: signer.sign(policyHash), signerPubkey: signer.publicKey } : {}),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
