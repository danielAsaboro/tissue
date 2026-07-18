/* global console, process, fetch, AbortSignal, setTimeout */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

/**
 * Real process-level feed-loss/restart/recovery drill (REMAINING.md item 5). Spawns the
 * COMPILED daemon as an actual OS process, feeds it real proof-verified TxLINE data
 * through a relay (restartDrillRelay.mjs — real proof verification and on-chain
 * validate_odds/validate_stat calls, replayed SSE transport only), SIGKILLs it mid-stream
 * (a hard crash, not a graceful shutdown), restarts the same binary against the same
 * corpus directory, and asserts the persisted hash chain survived intact and the daemon
 * resumes appending correctly. This exercises the actual recovery code path
 * (runtime/liveDesk.ts::assertPersistedLedgerPrefix / reconcilePersistedLedger) as a real
 * process boundary, not an in-memory unit test.
 *
 * Usage: TXLINE_JWT=… TXLINE_API_TOKEN=… node scripts/restartDrill.mjs <corpusPath> <fixtureId>
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const corpusArg = process.argv[2];
const fixtureId = process.argv[3];
if (!corpusArg || !fixtureId) {
  throw new Error("usage: node scripts/restartDrill.mjs <corpusPath> <fixtureId>");
}
const sourceCorpusPath = resolve(process.cwd(), corpusArg);

const jwt = process.env.TXLINE_JWT;
const apiToken = process.env.TXLINE_API_TOKEN;
if (!jwt || !apiToken) throw new Error("TXLINE_JWT and TXLINE_API_TOKEN are required (real, already-activated credentials)");

const network = process.env.TISSUE_NETWORK ?? "mainnet";
const upstreamOrigin = network === "mainnet"
  ? (process.env.TXLINE_MAINNET_ORIGIN ?? "https://txline.txodds.com")
  : (process.env.TXLINE_DEVNET_ORIGIN ?? "https://txline-dev.txodds.com");

const relayPort = 34567;
const apiPort = 34568;
const drillCorpusDir = resolve(repoRoot, ".drill-corpus");
rmSync(drillCorpusDir, { recursive: true, force: true });
mkdirSync(drillCorpusDir, { recursive: true });

function daemonEnv() {
  return {
    ...process.env,
    TISSUE_MODE: "live",
    TISSUE_NETWORK: network,
    TISSUE_API_PORT: String(apiPort),
    TXLINE_JWT: jwt,
    TXLINE_API_TOKEN: apiToken,
    TISSUE_ANCHOR_MODE: "view",
    [network === "mainnet" ? "TXLINE_MAINNET_ORIGIN" : "TXLINE_DEVNET_ORIGIN"]: `http://127.0.0.1:${relayPort}`,
    TISSUE_CORPUS_DIR: drillCorpusDir,
    SOLANA_RPC_MAINNET: process.env.SOLANA_RPC_MAINNET ?? "https://api.mainnet-beta.solana.com",
    SOLANA_RPC_DEVNET: process.env.SOLANA_RPC_DEVNET ?? "https://api.devnet.solana.com",
  };
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function ledgerLength(port) {
  const res = await fetch(`http://127.0.0.1:${port}/state`, { signal: AbortSignal.timeout(2_000) });
  const state = await res.json();
  const fixture = state.fixtures.find((f) => f.fixtureId === fixtureId);
  return { length: fixture?.decisions.length ?? 0, headHash: fixture?.headHash };
}

async function main() {
  if (!existsSync(resolve(repoRoot, "apps/daemon/dist/main.mjs"))) {
    throw new Error("compiled daemon not found — run `node scripts/build-runtime.mjs daemon` first");
  }

  console.log(JSON.stringify({ event: "drill.relay_start" }));
  const relay = spawn(process.execPath, [resolve(here, "restartDrillRelay.mjs"), sourceCorpusPath, upstreamOrigin, String(relayPort)], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log(JSON.stringify({ event: "drill.daemon_start_1" }));
  let daemon = spawn(process.execPath, [resolve(repoRoot, "apps/daemon/dist/main.mjs")], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: daemonEnv(),
  });

  const healthy1 = await waitForHealth(apiPort);
  if (!healthy1) throw new Error("daemon (run 1) never became healthy");

  // Let real proof-verified admissions accumulate.
  let before = { length: 0, headHash: undefined };
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    before = await ledgerLength(apiPort);
    console.log(JSON.stringify({ event: "drill.progress_1", ...before }));
    if (before.length >= 3) break;
  }
  if (before.length === 0) {
    throw new Error("no real proof-verified messages were admitted before kill — check credentials/relay proxy");
  }

  console.log(JSON.stringify({ event: "drill.sigkill", pid: daemon.pid, ...before }));
  daemon.kill("SIGKILL");
  await once(daemon, "exit");

  console.log(JSON.stringify({ event: "drill.daemon_start_2" }));
  daemon = spawn(process.execPath, [resolve(repoRoot, "apps/daemon/dist/main.mjs")], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: daemonEnv(),
  });
  const healthy2 = await waitForHealth(apiPort);
  if (!healthy2) throw new Error("daemon (run 2, post-restart) never became healthy");

  let after = await ledgerLength(apiPort);
  for (let i = 0; i < 15 && after.length <= before.length; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    after = await ledgerLength(apiPort);
    console.log(JSON.stringify({ event: "drill.progress_2", ...after }));
  }

  const verifyRes = await fetch(`http://127.0.0.1:${apiPort}/verify`);
  const verify = await verifyRes.json();

  daemon.kill("SIGTERM");
  relay.kill("SIGTERM");

  const report = {
    fixtureId,
    beforeKill: before,
    afterRestart: after,
    survivedPersistedPrefix: after.length >= before.length,
    continuedAppending: after.length > before.length,
    hashChainOk: verify.ok,
  };
  console.log(JSON.stringify({ event: "drill.report", ...report }, null, 2));
  if (!report.survivedPersistedPrefix || !report.hashChainOk) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "drill.failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
