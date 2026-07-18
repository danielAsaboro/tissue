import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { dirname } from "node:path";
import type { DecisionRecord } from "@tissue/shared";
import { GENESIS_HASH, linkHash } from "./hash.js";
import type { LedgerSigner } from "./signing.js";
import { verifyHashSignature } from "./signing.js";

/**
 * Hash-chained decision ledger (PRD §1.5, §7). Each record embeds the triggering feed
 * message hash and links to the previous record; `verifyChain` recomputes every link. This
 * is the "flight recorder" the dashboard renders and the object CI asserts replay against.
 *
 * When a `LedgerSigner` is supplied, every record's hash is also Ed25519-signed
 * (ledger/signing.ts) — chain links prove nothing was altered after the fact; the signature
 * additionally proves who produced it.
 */

export type DecisionInput = Omit<DecisionRecord, "seq" | "prevHash" | "hash" | "signature" | "signerPubkey">;

export class Ledger {
  private readonly records: DecisionRecord[] = [];

  constructor(private readonly signer?: LedgerSigner) {}

  append(input: DecisionInput): DecisionRecord {
    const seq = this.records.length;
    const prevHash = seq === 0 ? GENESIS_HASH : this.records[seq - 1]!.hash;
    const withoutHash = { ...input, seq, prevHash };
    const hash = linkHash(prevHash, withoutHash);
    const record: DecisionRecord = this.signer
      ? { ...withoutHash, hash, signature: this.signer.sign(hash), signerPubkey: this.signer.publicKey }
      : { ...withoutHash, hash };
    this.records.push(record);
    return record;
  }

  all(): readonly DecisionRecord[] {
    return this.records;
  }

  get length(): number {
    return this.records.length;
  }

  get headHash(): string {
    return this.records.length === 0 ? GENESIS_HASH : this.records[this.records.length - 1]!.hash;
  }

  writeJsonl(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, this.records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    renameSync(temp, path);
  }

  appendJsonl(path: string, record: DecisionRecord): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
  }
}

/**
 * Recompute the chain; returns the first sequence where a link breaks, if any. `signature`
 * and `signerPubkey` are stripped before recomputing the link hash — they are attached
 * *after* the hash is computed (see Ledger.append) and are verified separately below, so
 * including them here would make every signed record fail its own hash check.
 */
export function verifyChain(records: readonly DecisionRecord[]): {
  ok: boolean;
  brokenAtSeq?: number;
  signatureInvalidAtSeq?: number;
} {
  let prevHash = GENESIS_HASH;
  let signatureInvalidAtSeq: number | undefined;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.seq !== i || r.prevHash !== prevHash) return { ok: false, brokenAtSeq: r.seq };
    const { hash, signature, signerPubkey, ...withoutHash } = r;
    const expected = linkHash(prevHash, withoutHash);
    if (expected !== hash) return { ok: false, brokenAtSeq: r.seq };
    if (signature && signerPubkey && signatureInvalidAtSeq === undefined) {
      if (!verifyHashSignature(hash, signature, signerPubkey)) signatureInvalidAtSeq = i;
    }
    prevHash = hash;
  }
  return signatureInvalidAtSeq !== undefined ? { ok: false, signatureInvalidAtSeq } : { ok: true };
}

export function readLedgerJsonl(path: string): DecisionRecord[] {
  if (!existsSync(path)) throw new Error(`ledger not found: ${path}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DecisionRecord);
}
