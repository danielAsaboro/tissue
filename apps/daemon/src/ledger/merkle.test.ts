import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "./merkle.js";

function leaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => sha256Hex(`leaf-${i}`));
}

describe("buildMerkleTree — deterministic, standard binary SHA-256 tree", () => {
  it("a single leaf is its own root", () => {
    const l = leaves(1);
    expect(buildMerkleTree(l).root).toBe(l[0]);
  });

  it("produces the same root for the same leaves every time", () => {
    const l = leaves(7);
    expect(buildMerkleTree(l).root).toBe(buildMerkleTree(l).root);
  });

  it("produces a different root when any leaf changes", () => {
    const l = leaves(5);
    const base = buildMerkleTree(l).root;
    const changed = [...l];
    changed[2] = sha256Hex("tampered");
    expect(buildMerkleTree(changed).root).not.toBe(base);
  });

  it("throws on an empty leaf set rather than returning a meaningless root", () => {
    expect(() => buildMerkleTree([])).toThrow();
  });

  it("handles odd leaf counts via duplicate-last-leaf convention without crashing", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17]) {
      const tree = buildMerkleTree(leaves(n));
      expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("merkleProof + verifyMerkleProof — real inclusion proofs, independent of the tree object", () => {
  it("every leaf in a tree produces a valid inclusion proof against the root", () => {
    for (const n of [1, 2, 3, 4, 5, 8, 13, 32]) {
      const l = leaves(n);
      const tree = buildMerkleTree(l);
      for (let i = 0; i < n; i++) {
        const proof = merkleProof(tree, i);
        expect(verifyMerkleProof(l[i]!, proof, tree.root)).toBe(true);
      }
    }
  });

  it("rejects a proof verified against the wrong leaf", () => {
    const l = leaves(8);
    const tree = buildMerkleTree(l);
    const proofForZero = merkleProof(tree, 0);
    expect(verifyMerkleProof(l[1]!, proofForZero, tree.root)).toBe(false);
  });

  it("rejects a proof verified against a tampered root", () => {
    const l = leaves(8);
    const tree = buildMerkleTree(l);
    const proof = merkleProof(tree, 3);
    expect(verifyMerkleProof(l[3]!, proof, sha256Hex("wrong-root"))).toBe(false);
  });

  it("rejects a proof with a tampered sibling hash", () => {
    const l = leaves(8);
    const tree = buildMerkleTree(l);
    const proof = merkleProof(tree, 5).map((node) => ({ ...node }));
    proof[0] = { ...proof[0]!, hash: sha256Hex("tampered-sibling") };
    expect(verifyMerkleProof(l[5]!, proof, tree.root)).toBe(false);
  });

  it("throws for an out-of-range leaf index", () => {
    const tree = buildMerkleTree(leaves(4));
    expect(() => merkleProof(tree, 4)).toThrow();
    expect(() => merkleProof(tree, -1)).toThrow();
  });
});
