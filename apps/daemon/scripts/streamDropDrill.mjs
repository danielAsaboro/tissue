/* global console, process, fetch, AbortSignal, setTimeout */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

/**
 * Real process-level feed-DROP drill — a distinct fault class from restartDrill.mjs's
 * SIGKILL/crash-recovery drill. This never kills the daemon process; it abruptly severs
 * the SSE connections mid-stream (relay's /__control__/drop) and asserts the daemon's own
 * reconnect logic (ingest/sseClient.ts) detects the drop and reconnects — real process
 * boundaries, real HTTP, real disconnect, no synthetic fallback.
 *
 * Unlike restartDrill.mjs, this does NOT require any message to pass real TxLINE proof
 * verification to produce a meaningful result — stream connect/disconnect/reconnect state
 * is observable via /state.streams regardless of whether admitted messages accumulate,
 * which matters because replaying old captured corpora against TxLINE's real proof
 * endpoints has a known limitation (feedback.md F-004/F-006): historical proofs aren't
 * reliably served for old messages. Reconnect resilience is independently real evidence.
 *
 * Usage: TXLINE_JWT=… TXLINE_API_TOKEN=… node scripts/streamDropDrill.mjs <corpusPath> <fixtureId>
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const corpusArg = process.argv[2];
const fixtureId = process.argv[3];
if (!corpusArg || !fixtureId) {
  throw new Error("usage: node scripts/streamDropDrill.mjs <corpusPath> <fixtureId>");
}
const sourceCorpusPath = resolve(process.cwd(), corpusArg);

const jwt = process.env.TXLINE_JWT;
const apiToken = process.env.TXLINE_API_TOKEN;
if (!jwt || !apiToken) throw new Error("TXLINE_JWT and TXLINE_API_TOKEN are required (real, already-activated credentials)");

const network = process.env.TISSUE_NETWORK ?? "devnet";
const upstreamOrigin = network === "mainnet"
  ? (process.env.TXLINE_MAINNET_ORIGIN ?? "https://txline.txodds.com")
  : (process.env.TXLINE_DEVNET_ORIGIN ?? "https://txline-dev.txodds.com");

const relayPort = 34667;
const apiPort = 34668;
const drillCorpusDir = resolve(repoRoot, ".drill-corpus-streamdrop");
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

async function streamsState(port) {
  const res = await fetch(`http://127.0.0.1:${port}/state`, { signal: AbortSignal.timeout(2_000) });
  const state = await res.json();
  return state.streams;
}

async function waitUntil(predicate, timeoutMs, describeFailure) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await predicate();
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${describeFailure} (last observed: ${JSON.stringify(last)})`);
}

async function main() {
  if (!existsSync(resolve(repoRoot, "apps/daemon/dist/main.mjs"))) {
    throw new Error("compiled daemon not found — run `node scripts/build-runtime.mjs daemon` first");
  }

  console.log(JSON.stringify({ event: "streamdrop.relay_start" }));
  const relay = spawn(process.execPath, [resolve(here, "restartDrillRelay.mjs"), sourceCorpusPath, upstreamOrigin, String(relayPort)], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, RELAY_PACE_MS: "300" },
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log(JSON.stringify({ event: "streamdrop.daemon_start" }));
  const daemon = spawn(process.execPath, [resolve(repoRoot, "apps/daemon/dist/main.mjs")], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: daemonEnv(),
  });

  const healthy = await waitForHealth(apiPort);
  if (!healthy) throw new Error("daemon never became healthy");

  console.log(JSON.stringify({ event: "streamdrop.wait_connected" }));
  const connected = await waitUntil(
    async () => {
      const streams = await streamsState(apiPort);
      return { ok: streams.scores.connected && streams.odds.connected, streams };
    },
    15_000,
    "streams never reached connected:true before the drop",
  );
  console.log(JSON.stringify({ event: "streamdrop.connected", streams: connected.streams }));

  console.log(JSON.stringify({ event: "streamdrop.drop" }));
  const dropRes = await fetch(`http://127.0.0.1:${relayPort}/__control__/drop`, { method: "POST" });
  const dropped = await dropRes.json();
  console.log(JSON.stringify({ event: "streamdrop.dropped", ...dropped }));

  console.log(JSON.stringify({ event: "streamdrop.wait_reconnect" }));
  const reconnected = await waitUntil(
    async () => {
      const streams = await streamsState(apiPort);
      return { ok: streams.scores.connected && streams.odds.connected, streams };
    },
    20_000,
    "daemon never reconnected both streams after the drop",
  );
  console.log(JSON.stringify({ event: "streamdrop.reconnected", streams: reconnected.streams }));

  // The daemon process itself must never have crashed or exited across the drop.
  const stillAlive = daemon.exitCode === null && !daemon.killed;
  const healthAfter = await fetch(`http://127.0.0.1:${apiPort}/health`, { signal: AbortSignal.timeout(2_000) });

  daemon.kill("SIGTERM");
  relay.kill("SIGTERM");

  const report = {
    fixtureId,
    streamsDroppedCount: dropped.dropped,
    survivedWithoutProcessCrash: stillAlive,
    reconnectedBothStreams: reconnected.streams.scores.connected && reconnected.streams.odds.connected,
    healthyAfterReconnect: healthAfter.ok,
  };
  console.log(JSON.stringify({ event: "streamdrop.report", ...report }, null, 2));
  if (!report.survivedWithoutProcessCrash || !report.reconnectedBothStreams || !report.healthyAfterReconnect) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "streamdrop.failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
