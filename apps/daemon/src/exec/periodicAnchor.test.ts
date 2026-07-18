import { describe, expect, it } from "vitest";
import { sha256Hex } from "../ledger/hash.js";
import { buildMerkleTree } from "../ledger/merkle.js";
import { isCheckpointDue, prepareCheckpointAnchor } from "./periodicAnchor.js";

function recordHashes(n: number): string[] {
  return Array.from({ length: n }, (_, i) => sha256Hex(`record-${i}`));
}

describe("prepareCheckpointAnchor — deterministic, offline, no network", () => {
  it("produces a stable hash for the same inputs", () => {
    const hashes = recordHashes(5);
    const a = prepareCheckpointAnchor("F1", 4, hashes);
    const b = prepareCheckpointAnchor("F1", 4, hashes);
    expect(a.hash).toBe(b.hash);
  });

  it("produces a different hash when fixtureId, seq, or the record set differs", () => {
    const hashes = recordHashes(5);
    const base = prepareCheckpointAnchor("F1", 4, hashes);
    expect(prepareCheckpointAnchor("F2", 4, hashes).hash).not.toBe(base.hash);
    expect(prepareCheckpointAnchor("F1", 3, hashes.slice(0, 4)).hash).not.toBe(base.hash);
    expect(prepareCheckpointAnchor("F1", 4, [...hashes].reverse()).hash).not.toBe(base.hash);
  });

  it("anchors the real Merkle root over the given record hashes, not an arbitrary summary", () => {
    const hashes = recordHashes(6);
    const c = prepareCheckpointAnchor("F1", 5, hashes);
    expect(c.merkleRoot).toBe(buildMerkleTree(hashes).root);
  });

  it("carries fixtureId and seq through verbatim", () => {
    const c = prepareCheckpointAnchor("F1", 4, recordHashes(5));
    expect(c).toMatchObject({ fixtureId: "F1", seq: 4 });
  });
});

describe("isCheckpointDue — pure, decision-count based (never wall-clock)", () => {
  it("is never due when the interval is disabled (0)", () => {
    expect(isCheckpointDue(100, null, 0)).toBe(false);
    expect(isCheckpointDue(100, 50, 0)).toBe(false);
  });

  it("fires the first checkpoint once seq reaches the interval", () => {
    expect(isCheckpointDue(19, null, 20)).toBe(false);
    expect(isCheckpointDue(20, null, 20)).toBe(true);
    expect(isCheckpointDue(25, null, 20)).toBe(true);
  });

  it("fires subsequent checkpoints only once a full interval has elapsed since the last one", () => {
    expect(isCheckpointDue(39, 20, 20)).toBe(false);
    expect(isCheckpointDue(40, 20, 20)).toBe(true);
    expect(isCheckpointDue(41, 20, 20)).toBe(true);
  });
});
