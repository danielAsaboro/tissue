import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake Tissue daemon HTTP server for dashboard E2E testing. Real HTTP, real Next.js
 * server-side fetches against it (via TISSUE_DAEMON_URL) — only the daemon PROCESS is
 * fake, not the HTTP boundary the dashboard actually talks to. Configurable per-test so
 * every desk status (starting, verifying, quoting, watching, halted, error) and every
 * halt reason can be driven deterministically, without needing a live TxLINE/Solana
 * connection.
 */

export type DeskStatus = "starting" | "verifying" | "quoting" | "watching" | "halted" | "error";

export interface FakeDecision {
  readonly seq: number;
  readonly triggerMsgId: string;
  readonly triggerHash: string;
  readonly triggerNetwork: "devnet";
  readonly ts: number;
  readonly action: "POST" | "REPLACE" | "CANCEL" | "NO_ACTION" | "HALT";
  readonly radarClass?: string;
  readonly haltReason?: string;
  readonly state: {
    readonly minute: number;
    readonly homeScore: number;
    readonly awayScore: number;
    readonly homeReds: number;
    readonly awayReds: number;
    readonly inventory: { readonly bySelection: Record<string, number>; readonly netUnits: number };
    readonly exposure: {
      readonly perMarketUnits: Record<string, number>;
      readonly perFixtureUnits: number;
      readonly openIntents: number;
      readonly realizedPnlUnits: number;
      readonly peakEquityUnits: number;
      readonly drawdownUnits: number;
    };
    readonly feedGapMs: number;
    readonly matchPhase: "regulation" | "extraTime" | "penalties";
    readonly stoppageActive: boolean;
    readonly mutualDangerActive: boolean;
    readonly narrativeRegime: "neutral" | "cautious" | "compounding" | "oscillating";
  };
  readonly tissueProb: number;
  readonly marketProb: number;
  readonly edgeBps: number;
  readonly intents: unknown[];
  readonly simulated: boolean;
  readonly prevHash: string;
  readonly hash: string;
}

function decision(overrides: Partial<FakeDecision> = {}): FakeDecision {
  return {
    seq: 0,
    triggerMsgId: "m0",
    triggerHash: "th0",
    triggerNetwork: "devnet",
    ts: Date.now(),
    action: "NO_ACTION",
    state: {
      minute: 12,
      homeScore: 0,
      awayScore: 0,
      homeReds: 0,
      awayReds: 0,
      inventory: { bySelection: {}, netUnits: 0 },
      exposure: { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 },
      feedGapMs: 0,
      matchPhase: "regulation",
      stoppageActive: false,
      mutualDangerActive: false,
      narrativeRegime: "neutral",
    },
    tissueProb: 5400,
    marketProb: 5200,
    edgeBps: 200,
    intents: [],
    simulated: false,
    prevHash: "0".repeat(64),
    hash: "a".repeat(64),
    ...overrides,
  };
}

export interface FakeDeskState {
  readonly status: DeskStatus;
  readonly decisions?: readonly FakeDecision[];
  readonly haltReason?: string;
  readonly error?: string;
  readonly hasFixture?: boolean;
}

function buildState(cfg: FakeDeskState) {
  const decisions = cfg.decisions ?? (cfg.hasFixture === false ? [] : [decision({ seq: 0 })]);
  const lastDecision = decisions.at(-1);
  const fixtures = cfg.hasFixture === false ? [] : [{
    fixtureId: "E2E-FX",
    messages: decisions.length,
    decisions,
    quotes: [],
    radarEvents: [],
    anchors: [],
    grade: {
      generatedAtMsgId: lastDecision?.triggerMsgId ?? "m0",
      clv: { n: 4, meanClvBps: 85, medianClvBps: 80, p25Bps: 10, p75Bps: 150, pctPositive: 0.6 },
      brier: { brier: 0.21, reliability: 0.02, resolution: 0.06, uncertainty: 0.25, bins: [] },
      latency: [{ market: "1X2", n: 3, p10Ms: 2000, p50Ms: 4000, p90Ms: 8000 }],
      perClass: [{ signalClass: "late-reaction", n: 2, hitRate: 0.5, meanClvBps: 60 }],
      pnl: { realizedUnits: 12000, matchedIntents: 2, settlementTxSigs: [], simulated: true },
    },
    headHash: lastDecision?.hash ?? "0".repeat(64),
    hashChainOk: true,
    finalScore: { home: lastDecision?.state.homeScore ?? 0, away: lastDecision?.state.awayScore ?? 0 },
    preMatchCommitment: null,
    checkpoints: [],
    venueExecutions: [],
  }];

  return {
    mode: "live" as const,
    execution: "quote-publication" as const,
    status: cfg.status,
    network: "devnet" as const,
    origin: "https://fake-txline.example",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    lastFeedAt: cfg.status === "starting" ? null : Date.now(),
    streams: {
      scores: { connected: cfg.status !== "starting" && cfg.status !== "error", gapMs: 0, lastActivityAt: Date.now() },
      odds: { connected: cfg.status !== "starting" && cfg.status !== "error", gapMs: 0, lastActivityAt: Date.now() },
    },
    proofs: { pending: cfg.status === "verifying" ? 1 : 0, failed: 0, verified: 4, circuitKilled: false },
    activeFixtureId: fixtures.length > 0 ? "E2E-FX" : null,
    fixtures,
    portfolio: { exposureUnits: 0, drawdownUnits: 0, killed: false },
    ...(cfg.error ? { error: cfg.error } : {}),
  };
}

export interface FakeDaemon {
  readonly url: string;
  setState(cfg: FakeDeskState): void;
  close(): Promise<void>;
}

export async function startFakeDaemon(initial: FakeDeskState, port = 0): Promise<FakeDaemon> {
  let current = initial;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("access-control-allow-origin", "*");
    // Admin endpoint: Playwright's webServer runs this process separately from the test
    // file, so tests reconfigure desk state over HTTP rather than in-process.
    if (url.pathname === "/__admin__/state" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      req.on("end", () => {
        current = JSON.parse(body) as FakeDeskState;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (url.pathname === "/state") {
      const body = JSON.stringify(buildState(current));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (url.pathname === "/verify") {
      const state = buildState(current);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: state.fixtures.every((f) => f.hashChainOk),
        fixtures: state.fixtures.map((f) => ({ fixtureId: f.fixtureId, ok: f.hashChainOk, headHash: f.headHash })),
      }));
      return;
    }
    if (url.pathname === "/arena") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(
        current.hasFixture === false
          ? { available: false, reason: "no active fixture yet" }
          : {
            available: true,
            fixtureId: "E2E-FX",
            tissue: { meanClvBps: 85, clvN: 4, brier: 0.21 },
            baseline: { meanClvBps: 60, clvN: 4, brier: 0.24 },
            clvEdgeBps: 25,
            brierEdge: -0.03,
          },
      ));
      return;
    }
    if (url.pathname === "/arena/ablation") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(
        current.hasFixture === false
          ? { available: false, reason: "no active fixture yet" }
          : {
            available: true,
            fixtureId: "E2E-FX",
            baseline: { meanClvBps: 60, clvN: 4, brier: 0.24 },
            rows: [
              { regime: "stoppage", meanClvBps: 70, clvN: 4, brier: 0.23, clvEdgeBps: 10, brierEdge: -0.01 },
              { regime: "mutual_danger", meanClvBps: 65, clvN: 4, brier: 0.235, clvEdgeBps: 5, brierEdge: -0.005 },
              { regime: "narrative", meanClvBps: 62, clvN: 4, brier: 0.238, clvEdgeBps: 2, brierEdge: -0.002 },
              { regime: "informed_flow", meanClvBps: 80, clvN: 4, brier: 0.22, clvEdgeBps: 20, brierEdge: -0.02 },
              { regime: "stale_quote", meanClvBps: 61, clvN: 4, brier: 0.239, clvEdgeBps: 1, brierEdge: -0.001 },
            ],
          },
      ));
      return;
    }
    if (url.pathname === "/grade-card.svg") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#F2F0EB"/><text x="40" y="80" font-size="32">E2E fake grade card</text></svg>`;
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(svg);
      return;
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: state\ndata: ${JSON.stringify(buildState(current))}\n\n`);
      req.on("close", () => res.end());
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const boundPort = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    setState(cfg) {
      current = cfg;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export { decision };
