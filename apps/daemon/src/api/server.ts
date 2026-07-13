import { createServer, type Server, type ServerResponse } from "node:http";
import type { LiveConfig } from "../runtime/config.js";
import type { LiveDesk } from "../runtime/liveDesk.js";

const MAX_SSE_CLIENTS = 100;
const MAX_SSE_BUFFER_BYTES = 1_048_576;
const SSE_HEARTBEAT_MS = 15_000;
const cleanups = new WeakMap<Server, () => void>();

function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  res.end(encoded);
}

function metrics(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  res.end(body);
}

export function createApiServer(desk: LiveDesk, config: LiveConfig): Server {
  const sseClients = new Set<ServerResponse>();
  const unsubscribe = desk.subscribe((snapshot) => {
    const frame = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of sseClients) {
      if (client.destroyed || client.writableEnded || client.writableLength > MAX_SSE_BUFFER_BYTES) {
        sseClients.delete(client);
        client.destroy();
      } else {
        client.write(frame);
      }
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of sseClients) client.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_MS);
  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-methods": "GET, OPTIONS" });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const snapshot = desk.snapshot();
    if (url.pathname === "/health") {
      const healthy = snapshot.status !== "error" && snapshot.status !== "halted";
      json(res, 200, {
        alive: true,
        ok: healthy,
        status: snapshot.status,
        mode: snapshot.mode,
        network: snapshot.network,
        lastFeedAt: snapshot.lastFeedAt,
        streams: snapshot.streams,
        error: snapshot.error,
      });
      return;
    }
    if (url.pathname === "/ready") {
      const ready = snapshot.lastFeedAt !== null
        && snapshot.proofs.verified > 0
        && snapshot.status !== "error"
        && snapshot.status !== "halted"
        && snapshot.status !== "verifying"
        && snapshot.proofs.failed === 0;
      json(res, ready ? 200 : 503, {
        ready,
        status: snapshot.status,
        lastFeedAt: snapshot.lastFeedAt,
        verifiedProofs: snapshot.proofs.verified,
      });
      return;
    }
    if (url.pathname === "/state") {
      json(res, 200, snapshot);
      return;
    }
    if (url.pathname === "/verify") {
      json(res, 200, {
        ok: snapshot.fixtures.every((fixture) => fixture.hashChainOk),
        fixtures: snapshot.fixtures.map((fixture) => ({
          fixtureId: fixture.fixtureId,
          ok: fixture.hashChainOk,
          headHash: fixture.headHash,
        })),
      });
      return;
    }
    if (url.pathname === "/metrics") {
      const counters = desk.metrics();
      metrics(res, [
        "# HELP tissue_stream_failures_total TxLINE stream failures observed by the daemon.",
        "# TYPE tissue_stream_failures_total counter",
        `tissue_stream_failures_total ${counters.streamFailures}`,
        "# HELP tissue_source_proof_failures_total Score or odds source proofs that failed validation.",
        "# TYPE tissue_source_proof_failures_total counter",
        `tissue_source_proof_failures_total ${counters.sourceProofFailures}`,
        "# HELP tissue_source_admission_failures_total Verified inputs that failed durable engine admission.",
        "# TYPE tissue_source_admission_failures_total counter",
        `tissue_source_admission_failures_total ${counters.sourceAdmissionFailures}`,
        "# HELP tissue_source_proofs_pending Source proofs currently pending.",
        "# TYPE tissue_source_proofs_pending gauge",
        `tissue_source_proofs_pending ${snapshot.proofs.pending}`,
        "# HELP tissue_source_proofs_verified Source proofs currently retained as verified evidence.",
        "# TYPE tissue_source_proofs_verified gauge",
        `tissue_source_proofs_verified ${snapshot.proofs.verified}`,
        "# HELP tissue_sse_clients Current evidence SSE clients.",
        "# TYPE tissue_sse_clients gauge",
        `tissue_sse_clients ${sseClients.size}`,
        "",
      ].join("\n"));
      return;
    }
    if (url.pathname === "/events") {
      if (sseClients.size >= MAX_SSE_CLIENTS) {
        json(res, 503, { error: "sse_capacity_reached", maxClients: MAX_SSE_CLIENTS });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        ...securityHeaders(),
      });
      sseClients.add(res);
      res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
      const remove = () => sseClients.delete(res);
      req.on("close", remove);
      res.on("error", remove);
      return;
    }
    json(res, 404, {
      error: "not_found",
      available: ["/health", "/ready", "/state", "/verify", "/metrics", "/events"],
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    for (const client of sseClients) client.end();
    sseClients.clear();
  };
  cleanups.set(server, cleanup);
  server.on("close", cleanup);
  return server;
}

export async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
}

export async function closeApiServer(server: Server): Promise<void> {
  cleanups.get(server)?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
