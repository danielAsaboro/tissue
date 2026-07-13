import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { millis, type ScoreMessage } from "@tissue/shared";
import { createApiServer } from "../api/server.js";
import { CORPUS_DIR, corpusPath, readCorpus, writeCorpus } from "../ingest/corpus.js";
import { loadPolicy } from "../config/policy.js";
import { readLedgerJsonl } from "../ledger/ledger.js";
import { runEngine } from "../replay/engine.js";
import type { LiveConfig } from "./config.js";
import { admittedSourceMessage, assertPersistedLedgerPrefix, LiveDesk, reconcilePersistedLedger } from "./liveDesk.js";

const FIXTURE = "LIVE-INTEGRATION-1";
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

afterEach(async () => {
  for (const desk of desks.splice(0)) desk.stop();
  for (const stream of streams) stream.end();
  streams.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  rmSync(corpusPath(FIXTURE), { force: true });
  rmSync(join(CORPUS_DIR, `${FIXTURE}.ledger.jsonl`), { force: true });
  rmSync(join(CORPUS_DIR, `${FIXTURE}.analyst.json`), { force: true });
  rmSync(join(CORPUS_DIR, "anchor-evidence.json"), { force: true });
  rmSync(join(CORPUS_DIR, "anchor-evidence.jsonl"), { force: true });
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
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "fixture-jwt", apiToken: "fixture-token" });
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
    expect(existsSync(corpusPath(FIXTURE))).toBe(false);
    expect(existsSync(join(CORPUS_DIR, `${FIXTURE}.analyst.json`))).toBe(false);
    const proofJournal = readFileSync(join(CORPUS_DIR, "anchor-evidence.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as { messageId: string });
    expect(proofJournal.map((row) => row.messageId).sort()).toEqual(["odds-1", "score-1"]);
    expect(existsSync(join(CORPUS_DIR, "anchor-evidence.json"))).toBe(false);

    const verify = await fetch(`http://127.0.0.1:${apiPort}/verify`).then((response) => response.json()) as { ok: boolean };
    expect(verify.ok).toBe(true);
    const metrics = await fetch(`http://127.0.0.1:${apiPort}/metrics`).then((response) => response.text());
    expect(metrics).toContain("tissue_source_proof_failures_total 2");
    expect(metrics).toContain("tissue_source_proofs_verified 0");
    desk.stop();
  });

  it("surfaces stream authorization failures while retaining reconnect behavior", async () => {
    const txline = createServer((_req, res) => {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
    });
    const txlinePort = await bind(txline);
    const liveConfig = config(`http://127.0.0.1:${txlinePort}`);
    const desk = new LiveDesk(liveConfig, { network: "devnet", jwt: "invalid", apiToken: "invalid" });
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
    const desk = new LiveDesk(config(`http://127.0.0.1:${txlinePort}`), {
      network: "devnet", jwt: "fixture-jwt", apiToken: "fixture-token",
    });
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
    expect(existsSync(corpusPath(FIXTURE))).toBe(false);
    expect(desk.snapshot().fixtures).toHaveLength(0);
  });

  it("refuses to erase a corrupted persisted decision chain", async () => {
    const now = Date.now();
    const existing = score("persisted-score", now, 1);
    writeCorpus(FIXTURE, [existing]);
    const ledgerPath = join(CORPUS_DIR, `${FIXTURE}.ledger.jsonl`);
    runEngine([existing], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false }).ledger.writeJsonl(ledgerPath);
    const record = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as Record<string, unknown>;
    record.hash = "f".repeat(64);
    writeFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");

    const rebuilt = runEngine([existing], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    expect(() => assertPersistedLedgerPrefix(FIXTURE, rebuilt)).toThrow("hash chain is broken");
    expect(readCorpus(FIXTURE)).toHaveLength(1);
    expect(readFileSync(ledgerPath, "utf8")).toContain("f".repeat(64));
  });

  it("recovers a valid ledger prefix when corpus persistence completed first", async () => {
    const now = Date.now();
    const first = score("score-1", now, 1);
    const second = score("score-2", now + 1_000, 2);
    writeCorpus(FIXTURE, [first, second]);
    const ledgerPath = join(CORPUS_DIR, `${FIXTURE}.ledger.jsonl`);
    runEngine([first], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false }).ledger.writeJsonl(ledgerPath);

    const rebuilt = runEngine([first, second], loadPolicy(), "devnet", { feedGapHalt: true, simulateFills: false });
    expect(() => assertPersistedLedgerPrefix(FIXTURE, rebuilt)).not.toThrow();
    reconcilePersistedLedger(FIXTURE, rebuilt);
    const recovered = readLedgerJsonl(ledgerPath);
    expect(recovered).toHaveLength(2);
    expect(recovered.at(-1)?.hash).toBe(rebuilt.ledger.headHash);
  });
});
