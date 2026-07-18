import { Keypair } from "@solana/web3.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitMemo } from "../src/exec/memoAnchor.js";

/**
 * One-off connectivity smoke test against a locally running `surfpool start`
 * instance (default RPC http://127.0.0.1:8899). Confirms Tissue's actual
 * memo-submission code path (exec/memoAnchor.ts) works against Surfpool
 * before relying on the automated suite in exec/surfpoolAnchoring.test.ts.
 * Not part of `pnpm test` — run manually: `pnpm --filter @tissue/daemon surfpool:smoke`
 */

async function main(): Promise<void> {
  const rpcUrl = process.env.SURFPOOL_RPC_URL ?? "http://127.0.0.1:8899";
  const keypair = Keypair.generate();
  const dir = mkdtempSync(join(tmpdir(), "surfpool-smoke-"));
  const keypairPath = join(dir, "keypair.json");
  writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));

  const airdropRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "requestAirdrop",
      params: [keypair.publicKey.toBase58(), 2_000_000_000],
    }),
  });
  const airdropJson = (await airdropRes.json()) as { result?: string; error?: unknown };
  if (!airdropJson.result) throw new Error(`airdrop failed: ${JSON.stringify(airdropJson.error)}`);
  console.log("airdrop tx:", airdropJson.result);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const result = await submitMemo("tissue-surfpool-smoke-test", {
    rpcUrl,
    keypairPath,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "confirmed") {
    throw new Error(`expected confirmed, got ${result.status}: ${result.error}`);
  }
  console.log("OK — real memo transaction confirmed against Surfpool via Tissue's actual submitMemo() code path.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
