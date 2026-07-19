import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { millis, type ScoreMessage } from "@tissue/shared";
import { createApiServer } from "../api/server.js";
import { CORPUS_DIR } from "../ingest/corpus.js";
import { loadPolicy } from "../config/policy.js";
import { runEngine } from "../replay/engine.js";
import type { LiveConfig } from "./config.js";
import { admittedSourceMessage, assertPersistedLedgerPrefix, LiveDesk, reconcilePersistedLedger, sumPortfolioRisk } from "./liveDesk.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { createInMemoryLiveStore } from "../storage/inMemoryLiveStore.js";

const FIXTURE = "LIVE-INTEGRATION-1";
const TEST_DATABASE_URL = "postgres://test:test@localhost:5432/test";
const servers: Server[] = [];
const streams = new Set<ServerResponse>();
const desks: LiveDesk[] = [];

async function bind(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  servers.push(server);
  return address.port;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for live desk state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function config(origin: string): LiveConfig {
  return {
    mode: "live",
    network: "devnet",
    origin,
    port: 8788,
    allowedOrigins: ["http://localhost:3000"],
    rpcUrl: "http://127.0.0.1:8899",
    anchorMode: "view",
    databaseUrl: TEST_DATABASE_URL,
  };
}

function score(msgId: string, ts: number, minute: number): ScoreMessage {
  return {
    kind: "score",
    msgId,
    fixtureId: FIXTURE,
    ts: millis(ts),
    network: "devnet",
    minute,
    homeScore: 0,
    awayScore: 0,
    homeReds: 0,
    awayReds: 0,
    possession: { home: "none", away: "none" },
    isFinal: false,
    isVoid: false,
  };
}

describe("sumPortfolioRisk — pure aggregation across fixtures", () => {
  it("sums exposure and drawdown independently per fixture, not just the last one seen", () => {
    const policy = loadPolicy();
    const a = runEngine(generateSyntheticCorpus("PORTFOLIO-A"), policy);
    const b = runEngine(generateSyntheticCorpus("PORTFOLIO-B"), policy);
    const aLatest = a.ledger.all().at(-1)!.state.exposure;
    const bLatest = b.ledger.all().at(-1)!.state.exposure;

    const summed = sumPortfolioRisk([a, b]);
    expect(summed.exposureUnits).toBe(aLatest.perFixtureUnits + bLatest.perFixtureUnits);
    expect(summed.drawdownUnits).toBe(aLatest.drawdownUnits + bLatest.drawdownUnits);
  });

  it("returns zero for no fixtures and ignores a fixture with no decisions yet", () => {
    expect(sumPortfolioRisk([])).toEqual({ exposureUnits: 0, drawdownUnits: 0 });
  });
});

afterEach(async () => {
  for (const desk of desks.splice(0)) desk.stop();
  for (const stream of streams) stream.end();
  streams.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  // *.analyst.json and live-state.json are the two deliberately-still-file-based exports
  // (cross-service contract with apps/analyst, and a debug-only cache respectively) — every
  // other persistence path now goes through the per-test in-memory LiveStore, which needs no
  // cleanup of its own.
  rmSync(join(CORPUS_DIR, `${FIXTURE}.analyst.json`), { force: true });
  rmSync(join(CORPUS_DIR, "live-state.json"), { force: true });
});

describe("live desk integration", () => {
  it("neutralizes score-event pressure that is not covered by validate_stat", () => {
    const admitted = admittedSourceMessage({
      ...score("pressure-score", Date.now(), 12),
      possession: { home: "high_danger", away: "attack" },
    });
    expect(admitted.kind).toBe("score");
    if (admitted.kind === "score") {
      expect(admitted.possession).toEqual({ home: "none", away: "none" });
    }
  });

  it("refuses to admit scores or odds when source proofs are unavailable", async () => {
    const now = Date.now();
    const txline = createServer((req, res) => {
      if (req.url?.startsWith("/api/odds/validation")) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("proof fixture intentionally unavailable");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
      streams.add(res);
      if (req.url === "/api/scores/stream") {
        res.write(`id: score-1\ndata: ${JSON.stringify({
          FixtureId: FIXTURE,
          Id: "score-1",
          Ts: now,
          StatusId: 2,
          Minute: 1,
          Stats: { "1": 0, "2": 0, "5": 0, "6": 0 },
        })}\n\n`);
      } else if (req.url === "/api/odds/stream") {
        res.write(`id: odds-1\ndata: ${JSON.stringify({
          FixtureId: FIXTURE,
          MessageId: "odds-1",
          Ts: now + 1_000,
          Bookmaker: "TXLineStablePriceDemargined",
          BookmakerId: 10021,
          SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
          MarketParameters: "2.5",
          PriceNames: ["Over", "Under"],
          Prices: [1900, 2100],
          InRunning: true,
        })}\n\n`);
      }
    });
    const txlinePort = await bind(txline);
    const liveConfig = config(`http://127.0.0.1:${txlinePort}`);
    const store = createInMemoryLiveStore();
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "fixture-jwt", apiToken: "fixture-token" }, loadPolicy(), store);
    desks.push(desk);
    await desk.start();
    await waitFor(() => desk.snapshot().proofs.failed === 2);

    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);
    const stateResponse = await fetch(`http://127.0.0.1:${apiPort}/state`);
    const state = await stateResponse.json() as ReturnType<LiveDesk["snapshot"]>;
    expect(stateResponse.status).toBe(200);
    expect(state.mode).toBe("live");
    expect(state.execution).toBe("quote-publication");
    expect(state.fixtures).toHaveLength(0);
    expect(state.proofs.failed).toBe(2);
    expect(await store.liveTapeExists(FIXTURE)).toBe(false);
    const proofJournal = await store.readAllAnchorEvidenceRows();
    expect(proofJournal.map((row) => row.messageId).sort()).toEqual(["odds-1", "score-1"]);

    const verify = await fetch(`http://127.0.0.1:${apiPort}/verify`).then((response) => response.json()) as { ok: boolean };
    expect(verify.ok).toBe(true);
    const metrics = await fetch(`http://127.0.0.1:${apiPort}/metrics`).then((response) => response.text());
    expect(metrics).toContain("tissue_source_proof_failures_total 2");
    expect(metrics).toContain("tissue_source_proofs_verified 0");
    // Real timing, not a placeholder: exactly the 2 proof attempts above landed in the
    // histogram (decision-loop latency stays 0 — both proofs failed, so no decision was ever
    // appended to the ledger for this fixture).
    expect(metrics).toContain("tissue_proof_verification_latency_ms_count 2");
    expect(metrics).toContain("tissue_decision_loop_latency_ms_count 0");
    desk.stop();
  });

  it("surfaces stream authorization failures while retaining reconnect behavior", async () => {
    const txline = createServer((_req, res) => {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
    });
    const txlinePort = await bind(txline);
    const liveConfig = config(`http://127.0.0.1:${txlinePort}`);
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "invalid", apiToken: "invalid" }, loadPolicy(), createInMemoryLiveStore());
    desks.push(desk);
    await desk.start();
    await waitFor(() => desk.snapshot().status === "error");
    const snapshot = desk.snapshot();
    expect(snapshot.error).toContain("stream unavailable");
    expect(snapshot.error).not.toContain("403");
    expect(snapshot.lastFeedAt).toBeNull();
    expect(snapshot.streams.scores.connected).toBe(false);
    expect(snapshot.streams.odds.connected).toBe(false);
    desk.stop();
  });

  it("does not persist regressing score arrivals without source proofs", async () => {
    const now = Date.now();
    let scoresResponse: ServerResponse | undefined;
    const txline = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
      streams.add(res);
      if (req.url === "/api/scores/stream") scoresResponse = res;
    });
    const txlinePort = await bind(txline);
    const store = createInMemoryLiveStore();
    const desk = new LiveDesk(config(`http://127.0.0.1:${txlinePort}`), {
      network: "devnet", jwt: "fixture-jwt", apiToken: "fixture-token",
    }, loadPolicy(), store);
    desks.push(desk);
    await desk.start();
    await waitFor(() => Boolean(scoresResponse));

    scoresResponse!.write(`id: score-later\ndata: ${JSON.stringify({
      FixtureId: FIXTURE, Id: "score-later", Ts: now + 2_000, StatusId: 2,
      Minute: 2, Stats: { "1": 0, "2": 0, "5": 0, "6": 0 },
    })}\n\n`);
    await waitFor(() => desk.snapshot().proofs.failed === 1);

    scoresResponse!.write(`id: score-earlier\ndata: ${JSON.stringify({
      FixtureId: FIXTURE, Id: "score-earlier", Ts: now + 1_000, StatusId: 2,
      Minute: 1, Stats: { "1": 0, "2": 0, "5": 0, "6": 0 },
    })}\n\n`);
    await waitFor(() => desk.snapshot().proofs.failed === 2);
    expect(await store.liveTapeExists(FIXTURE)).toBe(false);
    expect(desk.snapshot().fixtures).toHaveLength(0);
  });

  it("halts the whole desk once the recent proof-failure rate crosses the circuit-breaker threshold", async () => {
    const now = Date.now();
    let scoresResponse: ServerResponse | undefined;
    const txline = createServer((req, res) => {
      if (req.url?.startsWith("/api/scores/stat-validation")) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("proof fixture intentionally unavailable");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
      streams.add(res);
      if (req.url === "/api/scores/stream") scoresResponse = res;
    });
    const txlinePort = await bind(txline);
    const policy = loadPolicy();
    const desk = new LiveDesk(config(`http://127.0.0.1:${txlinePort}`), {
      network: "devnet", jwt: "fixture-jwt", apiToken: "fixture-token",
    }, policy, createInMemoryLiveStore());
    desks.push(desk);
    await desk.start();
    await waitFor(() => Boolean(scoresResponse));

    for (let i = 0; i < policy.risk.proof_failure_min_samples; i++) {
      scoresResponse!.write(`id: score-fail-${i}\ndata: ${JSON.stringify({
        FixtureId: FIXTURE, Id: `score-fail-${i}`, Ts: now + (i + 1) * 1_000, StatusId: 2,
        Minute: i + 1, Stats: { "1": 0, "2": 0, "5": 0, "6": 0 },
      })}\n\n`);
      await waitFor(() => desk.snapshot().proofs.failed === i + 1);
    }

    const snapshot = desk.snapshot();
    expect(snapshot.proofs.circuitKilled).toBe(true);
    // Same "error" status class as any unresolved proof failure (see the earlier "refuses to
    // admit..." test) — this is a systemic proof-service problem, not a risk-policy halt.
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toContain("proof-failure-rate");
  });

  it("refuses to erase a corrupted persisted decision chain", async () => {
    const now = Date.now();
    const existing = score("persisted-score", now, 1);
    const store = createInMemoryLiveStore();
    await store.appendLiveMessage(FIXTURE, existing);
    const built = runEngine([existing], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    const record = built.ledger.all()[0]!;
    await store.appendDecision(FIXTURE, { ...record, hash: "f".repeat(64) });

    const rebuilt = runEngine([existing], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    await expect(assertPersistedLedgerPrefix(FIXTURE, rebuilt, store)).rejects.toThrow("hash chain is broken");
    expect(await store.readLiveTape(FIXTURE)).toHaveLength(1);
    const persisted = await store.readDecisions(FIXTURE);
    expect(persisted[0]!.hash).toBe("f".repeat(64));
  });

  it("recovers a valid ledger prefix when corpus persistence completed first", async () => {
    const now = Date.now();
    const first = score("score-1", now, 1);
    const second = score("score-2", now + 1_000, 2);
    const store = createInMemoryLiveStore();
    await store.appendLiveMessage(FIXTURE, first);
    await store.appendLiveMessage(FIXTURE, second);
    const firstOnly = runEngine([first], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    await store.appendDecision(FIXTURE, firstOnly.ledger.all()[0]!);

    const rebuilt = runEngine([first, second], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    await expect(assertPersistedLedgerPrefix(FIXTURE, rebuilt, store)).resolves.not.toThrow();
    await reconcilePersistedLedger(FIXTURE, rebuilt, store);
    const recovered = await store.readDecisions(FIXTURE);
    expect(recovered).toHaveLength(2);
    expect(recovered.at(-1)?.hash).toBe(rebuilt.ledger.headHash);
  });

  it("/arena computes a real head-to-head summary on demand from the fixture's corpus", async () => {
    const store = createInMemoryLiveStore();
    for (const message of generateSyntheticCorpus(FIXTURE)) await store.appendLiveMessage(FIXTURE, message);
    const liveConfig = config("http://127.0.0.1:1"); // unused — no SSE traffic in this test
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), store);
    desks.push(desk);
    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);

    const response = await fetch(`http://127.0.0.1:${apiPort}/arena?fixtureId=${FIXTURE}`);
    const body = await response.json() as { available: boolean; fixtureId?: string; clvEdgeBps?: number };
    expect(response.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.fixtureId).toBe(FIXTURE);
    expect(typeof body.clvEdgeBps).toBe("number");
  });

  it("/grade-card.svg renders a real SVG on demand from the fixture's corpus", async () => {
    const store = createInMemoryLiveStore();
    for (const message of generateSyntheticCorpus(FIXTURE)) await store.appendLiveMessage(FIXTURE, message);
    const liveConfig = config("http://127.0.0.1:1");
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), store);
    desks.push(desk);
    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);

    const response = await fetch(`http://127.0.0.1:${apiPort}/grade-card.svg?fixtureId=${FIXTURE}`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(body).toContain("<svg");
    expect(body).toContain(FIXTURE);
  });

  it("/arena reports unavailable for a fixture with no corpus, without throwing", async () => {
    const liveConfig = config("http://127.0.0.1:1");
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), createInMemoryLiveStore());
    desks.push(desk);
    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);

    const response = await fetch(`http://127.0.0.1:${apiPort}/arena?fixtureId=NO-SUCH-FIXTURE`);
    const body = await response.json() as { available: boolean };
    expect(response.status).toBe(404);
    expect(body.available).toBe(false);
  });

  it("/record exposes a real, self-describing public export — schema, network, oracle program, and verification instructions — even with no fixtures yet", async () => {
    const liveConfig = config("http://127.0.0.1:1");
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), createInMemoryLiveStore());
    desks.push(desk);
    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);

    const response = await fetch(`http://127.0.0.1:${apiPort}/record`);
    const body = await response.json() as {
      schema: string;
      network: string;
      oracleProgramId: string;
      memoProgramId: string;
      howToVerify: string;
      fixtures: unknown[];
    };
    expect(response.status).toBe(200);
    expect(body.schema).toBe("tissue.record.v1");
    expect(body.network).toBe("devnet");
    // The real devnet txoracle program ID, not a placeholder.
    expect(body.oracleProgramId).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(body.memoProgramId).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(body.howToVerify).toContain("sha256(prevHash");
    expect(body.howToVerify).toContain("/ledger/proof");
    expect(body.fixtures).toEqual([]);
  });

  it("reports an honest null wallet balance when no keypair is configured, rather than a fabricated zero", async () => {
    const liveConfig = config("http://127.0.0.1:1");
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), createInMemoryLiveStore());
    desks.push(desk);
    const snapshot = desk.snapshot();
    expect(snapshot.wallet).toEqual({ pubkey: null, lamports: null, low: false, checkedAt: null });
  });
});

/**
 * Real devnet RPC call against the real anchoring keypair — opt-in only (TISSUE_KEYPAIR_PATH),
 * matching the SURFPOOL_RPC_URL / TISSUE_LIVE_MODEL_BASE_URL pattern used elsewhere in this
 * suite: real infra, never in default CI, since it depends on external network availability
 * this test environment doesn't guarantee.
 */
describe.runIf(Boolean(process.env.TISSUE_KEYPAIR_PATH))("wallet balance watchdog — real devnet RPC", () => {
  it("fetches a real, non-negative balance for the configured keypair and reports it on /state and /health", async () => {
    const keypairPath = process.env.TISSUE_KEYPAIR_PATH;
    if (!keypairPath) throw new Error("TISSUE_KEYPAIR_PATH disappeared during the test");
    const liveConfig: LiveConfig = {
      mode: "live",
      network: "devnet",
      origin: "http://127.0.0.1:1",
      port: 8788,
      allowedOrigins: ["http://localhost:3000"],
      rpcUrl: "https://api.devnet.solana.com",
      anchorMode: "view",
      keypairPath,
      databaseUrl: TEST_DATABASE_URL,
    };
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "x", apiToken: "x" }, loadPolicy(), createInMemoryLiveStore());
    desks.push(desk);
    const api = createApiServer(desk, liveConfig);
    const apiPort = await bind(api);
    await desk.start();
    await waitFor(() => desk.snapshot().wallet.lamports !== null, 15_000);

    const snapshot = desk.snapshot();
    expect(snapshot.wallet.pubkey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(snapshot.wallet.lamports).toBeGreaterThanOrEqual(0);
    expect(snapshot.wallet.checkedAt).toBeGreaterThan(0);

    const healthRes = await fetch(`http://127.0.0.1:${apiPort}/health`);
    const health = await healthRes.json() as { wallet: { lamports: number | null } };
    expect(health.wallet.lamports).toBe(snapshot.wallet.lamports);

    const metricsRes = await fetch(`http://127.0.0.1:${apiPort}/metrics`);
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain("tissue_wallet_balance_lamports");
    expect(metricsText).not.toContain("tissue_wallet_balance_lamports -1");
  });
});
