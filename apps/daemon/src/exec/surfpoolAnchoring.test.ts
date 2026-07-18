import { describe, expect, it, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bps, milliOdds, type TissueMarketPrice } from "@tissue/shared";
import { submitMemo } from "./memoAnchor.js";
import { preparePreMatchCommitment, submitPreMatchCommitment } from "./preMatchCommit.js";
import { prepareCheckpointAnchor, submitCheckpointAnchor } from "./periodicAnchor.js";
import { sha256Hex } from "../ledger/hash.js";

/**
 * Real, transaction-level anchoring scenario tests against a locally running
 * `surfpool start` instance (see scripts/surfpoolSmoke.ts for manual setup).
 * Guarded by SURFPOOL_RPC_URL exactly like the analyst's live-model integration
 * test guards on TISSUE_LIVE_MODEL_BASE_URL — opt-in, never run in default CI,
 * because it depends on an external process the CI environment does not run.
 *
 * These exercise Tissue's REAL exec/*.ts code paths against REAL submitted and
 * confirmed transactions — not mocked Connection objects. Surfpool's local
 * validator makes this fast and deterministic enough to run every scenario in
 * seconds instead of racing public devnet's rate limits (see feedback.md F-004).
 *
 * Scope note: blockhash-expiry was investigated manually against a live
 * Surfpool instance using surfnet_timeTravel and found NOT reliably
 * reproducible — the local block height resets in a way that does not
 * deterministically invalidate an in-flight blockhash. That scenario is
 * intentionally not included here rather than asserting on flaky behavior;
 * real blockhash-expiry handling is still exercised by the production
 * confirmTransaction() call path, just not independently verified via this
 * suite.
 */

const SURFPOOL_RPC_URL = process.env.SURFPOOL_RPC_URL;

function tempKeypairPath(secretKey: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "surfpool-anchoring-test-"));
  const path = join(dir, "keypair.json");
  writeFileSync(path, JSON.stringify(Array.from(secretKey)));
  return path;
}

async function airdrop(rpcUrl: string, pubkey: string, lamports: number): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [pubkey, lamports] }),
  });
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (!json.result) throw new Error(`airdrop failed: ${JSON.stringify(json.error)}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

function markets(): TissueMarketPrice[] {
  return [
    {
      marketKey: { market: "1X2" },
      fairProb: { HOME: bps(5000), DRAW: bps(2800), AWAY: bps(2200) },
      fairOdds: { HOME: milliOdds(2000), DRAW: milliOdds(3571), AWAY: milliOdds(4545) },
    },
  ];
}

describe.runIf(Boolean(SURFPOOL_RPC_URL))("anchoring against a real local Surfpool validator", () => {
  let fundedKeypairPath: string;
  let fundedPubkey: string;

  beforeAll(async () => {
    if (!SURFPOOL_RPC_URL) throw new Error("SURFPOOL_RPC_URL disappeared during the test");
    const keypair = Keypair.generate();
    fundedKeypairPath = tempKeypairPath(keypair.secretKey);
    fundedPubkey = keypair.publicKey.toBase58();
    await airdrop(SURFPOOL_RPC_URL, fundedPubkey, 10_000_000_000);
  });

  describe("pre-match commitment", () => {
    it("submits and confirms a real transaction for a real prepared commitment", async () => {
      const commitment = preparePreMatchCommitment("SURFPOOL-FX", 1000, markets());
      const evidence = await submitPreMatchCommitment(commitment, {
        rpcUrl: SURFPOOL_RPC_URL!,
        network: "devnet",
        keypairPath: fundedKeypairPath,
      });
      expect(evidence.status).toBe("confirmed");
      expect(evidence.txSig).toBeDefined();
      expect(evidence.slot).toBeGreaterThan(0);
      expect(evidence.hash).toBe(commitment.hash);
    });

    it("fails cleanly, without throwing, when the keypair has never been funded", async () => {
      const unfunded = Keypair.generate();
      const unfundedPath = tempKeypairPath(unfunded.secretKey);
      const commitment = preparePreMatchCommitment("SURFPOOL-FX", 1000, markets());
      const evidence = await submitPreMatchCommitment(commitment, {
        rpcUrl: SURFPOOL_RPC_URL!,
        network: "devnet",
        keypairPath: unfundedPath,
      });
      expect(evidence.status).toBe("failed");
      expect(evidence.error).toBeDefined();
      expect(evidence.txSig).toBeUndefined();
    });

    it("fails cleanly, without throwing, when the RPC endpoint is unreachable", async () => {
      const commitment = preparePreMatchCommitment("SURFPOOL-FX", 1000, markets());
      const evidence = await submitPreMatchCommitment(commitment, {
        rpcUrl: "http://127.0.0.1:1",
        network: "devnet",
        keypairPath: fundedKeypairPath,
      });
      expect(evidence.status).toBe("failed");
      expect(evidence.error).toBeDefined();
    });
  });

  describe("periodic checkpoint anchoring", () => {
    it("submits and confirms a real transaction anchoring a real Merkle root", async () => {
      const recordHashes = Array.from({ length: 10 }, (_, i) => sha256Hex(`record-${i}`));
      const commitment = prepareCheckpointAnchor("SURFPOOL-FX", 9, recordHashes);
      const evidence = await submitCheckpointAnchor(commitment, {
        rpcUrl: SURFPOOL_RPC_URL!,
        network: "devnet",
        keypairPath: fundedKeypairPath,
      });
      expect(evidence.status).toBe("confirmed");
      expect(evidence.txSig).toBeDefined();
      expect(evidence.merkleRoot).toBe(commitment.merkleRoot);
    });

    it("fails cleanly when the keypair has never been funded", async () => {
      const unfunded = Keypair.generate();
      const unfundedPath = tempKeypairPath(unfunded.secretKey);
      const recordHashes = [sha256Hex("only-record")];
      const commitment = prepareCheckpointAnchor("SURFPOOL-FX", 0, recordHashes);
      const evidence = await submitCheckpointAnchor(commitment, {
        rpcUrl: SURFPOOL_RPC_URL!,
        network: "devnet",
        keypairPath: unfundedPath,
      });
      expect(evidence.status).toBe("failed");
    });
  });

  describe("concurrent submissions with a shared keypair", () => {
    it("many truly-concurrent memo submissions from the same funded keypair all resolve — confirmed or a real explainable failure, never a hang or a thrown exception", async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          submitMemo(`surfpool-concurrent-${i}`, { rpcUrl: SURFPOOL_RPC_URL!, keypairPath: fundedKeypairPath })),
      );
      expect(results).toHaveLength(12);
      for (const result of results) {
        expect(["confirmed", "failed"]).toContain(result.status);
        if (result.status === "confirmed") {
          expect(result.txSig).toBeDefined();
        } else {
          expect(result.error).toBeDefined();
        }
      }
      // Every confirmed submission must carry a distinct signature — no accidental
      // dedup/collapse of concurrent transactions into one.
      const signatures = results.filter((r) => r.status === "confirmed").map((r) => r.txSig);
      expect(new Set(signatures).size).toBe(signatures.length);
    });
  });

  describe("real transaction evidence is independently checkable", () => {
    it("a confirmed transaction signature resolves to a real, independently fetchable on-chain transaction", async () => {
      const commitment = preparePreMatchCommitment("SURFPOOL-FX-VERIFY", 2000, markets());
      const evidence = await submitPreMatchCommitment(commitment, {
        rpcUrl: SURFPOOL_RPC_URL!,
        network: "devnet",
        keypairPath: fundedKeypairPath,
      });
      expect(evidence.status).toBe("confirmed");
      const res = await fetch(SURFPOOL_RPC_URL!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getTransaction",
          params: [evidence.txSig, { encoding: "json", maxSupportedTransactionVersion: 0 }],
        }),
      });
      const json = (await res.json()) as { result: { meta: { err: unknown } } | null };
      expect(json.result).not.toBeNull();
      expect(json.result!.meta.err).toBeNull();
    });
  });
});
