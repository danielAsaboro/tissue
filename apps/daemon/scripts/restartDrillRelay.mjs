/* global console, process, fetch, setTimeout, URL, Buffer */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

/**
 * Restart-drill relay (REMAINING.md item 5). Real feed-loss/restart drills need a live
 * match to tail; there isn't one right now, so this relays a REAL captured corpus as SSE
 * (transport only — deterministic pacing we control so we can kill the daemon mid-stream),
 * while proxying every other path (JWT/proof-validation endpoints) straight through to the
 * REAL TxLINE origin with real credentials. Proof verification and every on-chain
 * validate_odds/validate_stat call the daemon makes during this drill are genuine — only
 * the SSE transport is a controlled replay.
 */

const corpusPath = process.argv[2];
const upstreamOrigin = process.argv[3];
const port = Number(process.argv[4] ?? 34567);
const paceMs = Number(process.env.RELAY_PACE_MS ?? 150);

if (!corpusPath || !upstreamOrigin) {
  throw new Error("usage: restartDrillRelay.mjs <corpusPath> <upstreamOrigin> [port]");
}

// Fault injection state — every currently-open SSE stream response, so a control request
// can abruptly destroy them (simulating a real feed disconnect) without killing the relay
// process itself. This is a distinct fault class from the SIGKILL restart drill: it tests
// the daemon's SSE reconnect logic (ingest/sseClient.ts), not crash recovery.
const openStreams = new Set();

const messages = readFileSync(corpusPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const scoreMessages = messages.filter((m) => m.kind === "score");
const oddsMessages = messages.filter((m) => m.kind === "odds");

function rawScoreEvent(m) {
  // m.phase is the real StatusId the normalizer captured verbatim (ingest/normalize.ts
  // stores it as `phase: String(statusId)`) — reuse it so the replayed message matches
  // what the real proof response says the period/status actually was.
  return {
    Id: m.msgId,
    FixtureId: m.fixtureId,
    Ts: m.ts,
    Seq: m.sourceSeq,
    GlobalSeq: m.sourceSeq,
    StatusId: m.phase !== undefined ? Number(m.phase) : (m.isFinal ? 5 : 4),
    Minute: m.minute,
    Stats: { "1": m.homeScore, "2": m.awayScore, "5": m.homeReds, "6": m.awayReds },
  };
}

function rawOddsEvent(m) {
  const names = Object.keys(m.consensus);
  return {
    fixture_id: m.fixtureId,
    message_id: m.msgId,
    ts: m.ts,
    Bookmaker: m.bookmaker ?? "TXLineStablePriceDemargined",
    BookmakerId: m.bookmakerId ?? 10021,
    super_odds_type: m.marketKey.market === "1X2" ? "MATCH_ODDS" : "OVERUNDER_PARTICIPANT_GOALS",
    market_parameters: m.marketKey.lineTimes10 ? String(m.marketKey.lineTimes10 / 10) : undefined,
    price_names: names,
    prices: names.map((n) => (m.rawOdds?.[n] ?? Math.round(10_000_000 / m.consensus[n]))),
    in_running: m.inRunning ?? true,
  };
}

function sseFrame(id, payload) {
  return `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function streamTape(res, tape, mapper) {
  for (const m of tape) {
    if (res.destroyed || res.writableEnded) return;
    res.write(sseFrame(m.msgId, mapper(m)));
    await new Promise((resolve) => setTimeout(resolve, paceMs));
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/__control__/drop" && req.method === "POST") {
    const count = openStreams.size;
    for (const stream of openStreams) stream.destroy();
    openStreams.clear();
    console.log(JSON.stringify({ event: "relay.control_drop", streamsDropped: count }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ dropped: count }));
    return;
  }
  if (url.pathname === "/api/scores/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
    openStreams.add(res);
    res.on("close", () => openStreams.delete(res));
    console.log(JSON.stringify({ event: "relay.stream_open", stream: "scores" }));
    await streamTape(res, scoreMessages, rawScoreEvent);
    return;
  }
  if (url.pathname === "/api/odds/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
    openStreams.add(res);
    res.on("close", () => openStreams.delete(res));
    console.log(JSON.stringify({ event: "relay.stream_open", stream: "odds" }));
    await streamTape(res, oddsMessages, rawOddsEvent);
    return;
  }
  // Everything else (JWT renewal, /api/odds/validation, /api/scores/stat-validation, etc.)
  // proxies straight through to the REAL TxLINE origin with the real request headers.
  const upstream = await fetch(`${upstreamOrigin}${url.pathname}${url.search}`, {
    method: req.method,
    headers: { ...req.headers, host: new URL(upstreamOrigin).host },
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({
    event: "relay.listening",
    port,
    corpus: corpusPath,
    scoreMessages: scoreMessages.length,
    oddsMessages: oddsMessages.length,
    upstreamOrigin,
  }));
});
