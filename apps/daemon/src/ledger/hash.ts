import { createHash } from "node:crypto";

/**
 * Canonical serialization + hashing for the proof-chained ledger (PRD §1.5).
 * Determinism is the whole point: canonical JSON has sorted object keys so the same logical
 * record always serializes to the same bytes, and `replay(corpus) === ledger` can be
 * asserted bit-for-bit in CI. No floats enter a hashed record (fixed-point everywhere).
 */

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

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash of a triggering feed message payload (its canonical bytes). */
export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}

/** Link hash: H(prevHash ‖ canonical(recordWithoutHash)). */
export function linkHash(prevHash: string, recordWithoutHash: unknown): string {
  return sha256Hex(prevHash + "|" + canonicalize(recordWithoutHash));
}

export const GENESIS_HASH = "0".repeat(64);
