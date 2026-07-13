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

/**
 * Hash-chained decision ledger (PRD §1.5, §7). Each record embeds the triggering feed
 * message hash and links to the previous record; `verifyChain` recomputes every link. This
 * is the "flight recorder" the dashboard renders and the object CI asserts replay against.
 */

export type DecisionInput = Omit<DecisionRecord, "seq" | "prevHash" | "hash">;

export class Ledger {
  private readonly records: DecisionRecord[] = [];

  append(input: DecisionInput): DecisionRecord {
    const seq = this.records.length;
    const prevHash = seq === 0 ? GENESIS_HASH : this.records[seq - 1]!.hash;
    const withoutHash = { ...input, seq, prevHash };
    const hash = linkHash(prevHash, withoutHash);
    const record: DecisionRecord = { ...withoutHash, hash };
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

/** Recompute the chain; returns the first sequence where a link breaks, if any. */
export function verifyChain(records: readonly DecisionRecord[]): {
  ok: boolean;
  brokenAtSeq?: number;
} {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.seq !== i || r.prevHash !== prevHash) return { ok: false, brokenAtSeq: r.seq };
    const { hash, ...withoutHash } = r;
    const expected = linkHash(prevHash, withoutHash);
    if (expected !== hash) return { ok: false, brokenAtSeq: r.seq };
    prevHash = hash;
  }
  return { ok: true };
}

export function readLedgerJsonl(path: string): DecisionRecord[] {
  if (!existsSync(path)) throw new Error(`ledger not found: ${path}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DecisionRecord);
}
