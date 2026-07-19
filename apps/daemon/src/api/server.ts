import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { LiveConfig } from "../runtime/config.js";
import type { LiveDesk } from "../runtime/liveDesk.js";
import { CORPUS_DIR, readCorpus } from "../ingest/corpus.js";
import { loadPolicy } from "../config/policy.js";
import { loadAllPolicySnapshots } from "../config/policySnapshot.js";
import { runArena, summarizeArena } from "../arena/arena.js";
import { runAblationMatrix } from "../arena/ablation.js";
import { renderGradeCardSvg } from "../grader/gradeCard.js";
import { grade } from "../grader/grader.js";
import { runEngine } from "../replay/engine.js";
import { buildMerkleTree, merkleProof } from "../ledger/merkle.js";
import { PROGRAM_ID } from "../exec/anchor.js";

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

function svg(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  res.end(body);
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
        wallet: snapshot.wallet,
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
    if (url.pathname === "/record") {
      json(res, 200, {
        schema: "tissue.record.v1",
        generatedAt: new Date().toISOString(),
        network: snapshot.network,
        oracleProgramId: PROGRAM_ID[snapshot.network].toBase58(),
        memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        howToVerify:
          "For any decision: strip hash/signature/signerPubkey from the record, canonicalize " +
          "the rest (recursively sort object keys, JSON.stringify), then " +
          "sha256(prevHash + '|' + canonicalJson) must equal hash. Chain it: record[i].prevHash " +
          "must equal record[i-1].hash for every i. See /ledger/proof for a Merkle inclusion " +
          "proof of one decision against a specific anchored checkpoint root, verifiable with " +
          "only the leaf hash, the proof path, and the root — no trust in this server required. " +
          "If signature/signerPubkey are present, Ed25519-verify signature against hash using " +
          "signerPubkey. preMatchCommitment.txSig and each checkpoints[].txSig are real Solana " +
          "transactions carrying an SPL Memo with the committed hash/root — fetch them from any " +
          "public RPC or explorer, independent of this server, to confirm the commitment " +
          "predates the claims it anchors. Each fixture's slipExecutions[] carries real Slip " +
          "market/ticket addresses and buyTxSig for decisions that risked real capital on Slip " +
          "(exec/slipExec.ts) — fetch buyTxSig from any public RPC to confirm it landed.",
        portfolio: snapshot.portfolio,
        fixtures: snapshot.fixtures.map((fixture) => ({
          fixtureId: fixture.fixtureId,
          headHash: fixture.headHash,
          hashChainOk: fixture.hashChainOk,
          finalScore: fixture.finalScore,
          grade: fixture.grade,
          preMatchCommitment: fixture.preMatchCommitment,
          checkpoints: fixture.checkpoints,
          slipExecutions: fixture.slipExecutions,
          decisions: fixture.decisions.map((d) => ({
            seq: d.seq,
            triggerMsgId: d.triggerMsgId,
            triggerHash: d.triggerHash,
            triggerNetwork: d.triggerNetwork,
            ts: d.ts,
            action: d.action,
            ...(d.radarClass ? { radarClass: d.radarClass } : {}),
            ...(d.haltReason ? { haltReason: d.haltReason } : {}),
            policyHash: d.policyHash,
            tissueProb: d.tissueProb,
            marketProb: d.marketProb,
            edgeBps: d.edgeBps,
            simulated: d.simulated,
            prevHash: d.prevHash,
            hash: d.hash,
            ...(d.signature ? { signature: d.signature } : {}),
            ...(d.signerPubkey ? { signerPubkey: d.signerPubkey } : {}),
          })),
        })),
      });
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
    if (url.pathname === "/arena") {
      const fixtureId = url.searchParams.get("fixtureId") ?? snapshot.activeFixtureId;
      if (!fixtureId) {
        json(res, 200, { available: false, reason: "no active fixture yet" });
        return;
      }
      let corpus;
      try {
        corpus = readCorpus(fixtureId);
      } catch {
        json(res, 404, { available: false, reason: `no corpus for fixture ${fixtureId}` });
        return;
      }
      if (corpus.length === 0) {
        json(res, 200, { available: false, reason: `fixture ${fixtureId} has no messages yet` });
        return;
      }
      // On-demand — the SAME deterministic engine run over the SAME authoritative corpus the
      // live desk already captured; not a second continuously-running live session.
      const arena = runArena(corpus, loadPolicy(), snapshot.network);
      json(res, 200, { available: true, ...summarizeArena(arena) });
      return;
    }
    if (url.pathname === "/arena/ablation") {
      const fixtureId = url.searchParams.get("fixtureId") ?? snapshot.activeFixtureId;
      if (!fixtureId) {
        json(res, 200, { available: false, reason: "no active fixture yet" });
        return;
      }
      let corpus;
      try {
        corpus = readCorpus(fixtureId);
      } catch {
        json(res, 404, { available: false, reason: `no corpus for fixture ${fixtureId}` });
        return;
      }
      if (corpus.length === 0) {
        json(res, 200, { available: false, reason: `fixture ${fixtureId} has no messages yet` });
        return;
      }
      // Same on-demand, authoritative-corpus discipline as /arena — each regime graded
      // against the SAME neutralized baseline, isolating which flagged heuristic earns its
      // keep instead of only reporting the bundled effect.
      const matrix = runAblationMatrix(corpus, loadPolicy(), snapshot.network);
      json(res, 200, { available: true, ...matrix });
      return;
    }
    if (url.pathname === "/grade-card.svg") {
      const fixtureId = url.searchParams.get("fixtureId") ?? snapshot.activeFixtureId;
      if (!fixtureId) {
        json(res, 200, { available: false, reason: "no active fixture yet" });
        return;
      }
      let corpus;
      try {
        corpus = readCorpus(fixtureId);
      } catch {
        json(res, 404, { available: false, reason: `no corpus for fixture ${fixtureId}` });
        return;
      }
      if (corpus.length === 0) {
        json(res, 200, { available: false, reason: `fixture ${fixtureId} has no messages yet` });
        return;
      }
      const result = runEngine(corpus, loadPolicy(), snapshot.network);
      const sheet = grade(result, loadPolicy());
      svg(res, renderGradeCardSvg({
        fixtureId,
        network: snapshot.network,
        sheet,
        haltCount: result.halts.length,
        finalScore: result.finalScore,
        generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
      }));
      return;
    }
    if (url.pathname === "/ledger/proof") {
      const fixtureId = url.searchParams.get("fixtureId") ?? snapshot.activeFixtureId;
      const seqParam = url.searchParams.get("seq");
      const seq = seqParam === null ? NaN : Number(seqParam);
      if (!fixtureId) {
        json(res, 404, { available: false, reason: "no active fixture yet" });
        return;
      }
      if (!Number.isInteger(seq) || seq < 0) {
        json(res, 400, { available: false, reason: "seq must be a non-negative integer" });
        return;
      }
      const recordHashes = desk.getLedgerRecordHashes(fixtureId);
      if (!recordHashes || seq >= recordHashes.length) {
        json(res, 404, { available: false, reason: `no decision ${seq} for fixture ${fixtureId}` });
        return;
      }
      // The earliest checkpoint whose Merkle tree already includes this decision — an
      // inclusion proof can only be produced against a root that was actually anchored.
      const checkpoint = desk.getCheckpoints(fixtureId)
        .filter((c) => c.status === "confirmed" && c.seq >= seq)
        .sort((a, b) => a.seq - b.seq)[0];
      if (!checkpoint) {
        json(res, 404, { available: false, reason: `no confirmed checkpoint covers decision ${seq} yet` });
        return;
      }
      const tree = buildMerkleTree(recordHashes.slice(0, checkpoint.seq + 1));
      json(res, 200, {
        available: true,
        fixtureId,
        seq,
        leafHash: recordHashes[seq],
        root: tree.root,
        proof: merkleProof(tree, seq),
        checkpoint: { seq: checkpoint.seq, txSig: checkpoint.txSig, submittedAt: checkpoint.submittedAt },
      });
      return;
    }
    if (url.pathname === "/policy/snapshots") {
      json(res, 200, { snapshots: loadAllPolicySnapshots(join(CORPUS_DIR, "policy-snapshots.jsonl")) });
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
        "# HELP tissue_wallet_balance_lamports Real SOL balance of the anchoring keypair (-1 if unknown).",
        "# TYPE tissue_wallet_balance_lamports gauge",
        `tissue_wallet_balance_lamports ${snapshot.wallet.lamports ?? -1}`,
        "# HELP tissue_wallet_balance_low 1 if the anchoring keypair balance is below the configured warning threshold.",
        "# TYPE tissue_wallet_balance_low gauge",
        `tissue_wallet_balance_low ${snapshot.wallet.low ? 1 : 0}`,
        desk.latencyMetricsPrometheus(),
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
      available: ["/health", "/ready", "/state", "/verify", "/record", "/arena", "/arena/ablation", "/grade-card.svg", "/ledger/proof", "/policy/snapshots", "/metrics", "/events"],
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
