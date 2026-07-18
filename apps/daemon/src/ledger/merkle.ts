import { sha256Hex } from "./hash.js";

/**
 * Real Merkle tree over ledger record hashes. The hash chain (ledger/hash.ts, linkHash)
 * already proves the whole prefix is internally consistent — every record's hash folds in
 * everything before it, so a single head hash IS a commitment to the entire history (that's
 * what periodicAnchor.ts anchors on-chain). What the chain does NOT give you cheaply is an
 * INCLUSION PROOF for one specific past record without replaying/re-hashing the whole prefix
 * from genesis: verifying decision #47 belongs to a chain of 10,000 records means recomputing
 * all 10,000 links. A Merkle tree over the same leaves gives O(log n) inclusion proofs against
 * a root that gets anchored exactly the way the head hash already does.
 *
 * Standard binary tree, SHA-256, duplicate-last-leaf-on-odd-level (documented, deterministic,
 * matches the common Merkle convention TxLINE's own oddsSubTreeRoot/mainTreeProof use).
 */

export interface MerkleTree {
  readonly leaves: readonly string[];
  readonly levels: readonly (readonly string[])[];
  readonly root: string;
}

export interface MerkleProofNode {
  readonly hash: string;
  readonly isRightSibling: boolean;
}

function hashPair(left: string, right: string): string {
  return sha256Hex(left + right);
}

export function buildMerkleTree(leaves: readonly string[]): MerkleTree {
  if (leaves.length === 0) throw new Error("Merkle tree requires at least one leaf");
  const levels: string[][] = [[...leaves]];
  let current = levels[0]!;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      next.push(hashPair(left, right));
    }
    levels.push(next);
    current = next;
  }
  return { leaves, levels, root: current[0]! };
}

/** Inclusion proof for `leaves[index]` — sibling hashes from the leaf level up to the root. */
export function merkleProof(tree: MerkleTree, index: number): readonly MerkleProofNode[] {
  if (index < 0 || index >= tree.leaves.length) throw new Error(`Merkle leaf index out of range: ${index}`);
  const proof: MerkleProofNode[] = [];
  let idx = index;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level]!;
    const isRightSibling = idx % 2 === 0;
    const siblingIndex = isRightSibling ? idx + 1 : idx - 1;
    const siblingHash = siblingIndex < nodes.length ? nodes[siblingIndex]! : nodes[idx]!;
    proof.push({ hash: siblingHash, isRightSibling });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verifies a leaf + proof reconstructs the given root, independent of the tree object. */
export function verifyMerkleProof(leaf: string, proof: readonly MerkleProofNode[], root: string): boolean {
  let current = leaf;
  for (const node of proof) {
    current = node.isRightSibling ? hashPair(current, node.hash) : hashPair(node.hash, current);
  }
  return current === root;
}
