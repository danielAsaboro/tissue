import { createServer, type Server } from "node:http";
import { renameSync, rmSync } from "node:fs";
import { connectInMemory } from "./mcpBridge.js";
import { dgridConfig, FallbackLlmClient, groqConfig } from "./llm.js";
import { runAnalystQuery } from "./agent.js";
import { CORPUS_DIR, DB_PATH } from "./paths.js";
import { materializeExports, readExportsDir } from "./materialize.js";
import { ANALYST_SKILLS } from "./skills.js";
import { TOOLS } from "./tools.js";
import { loadTissueSlipConfig, TissueSlipConsumer } from "@tissue/slip";

/**
 * Tiny HTTP surface for the dashboard's "ask Tissue" panel: POST /chat { question } → grounded
 * answer + ledger citations + provider metadata. Runs the LLM+MCP tool loop server-side. This
 * process is fully isolated from the decision path — it holds only a READ-ONLY DB handle.
 *
 *   pnpm --filter @tissue/analyst serve   (PORT, default 8787)
 */

const MAX_BODY_BYTES = 8_192;
const MAX_QUESTION_CHARS = 1_000;
const MAX_CONCURRENT_CHATS = 4;
const MAX_CHATS_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
let projectionQueue: Promise<void> = Promise.resolve();

async function refreshProjection(): Promise<void> {
  const exports = readExportsDir(CORPUS_DIR).filter((entry) => !entry.fixtureId.startsWith("SYN-"));
  if (exports.length === 0) {
    throw new Error(`No real analyst exports are available in ${CORPUS_DIR}. Start the live daemon and wait for TxLINE data.`);
  }
  projectionQueue = projectionQueue.then(() => {
    const temp = `${DB_PATH}.tmp`;
    rmSync(temp, { force: true });
    materializeExports(temp, exports);
    renameSync(temp, DB_PATH);
  });
  await projectionQueue;
}

async function handleChat(question: string, slip: TissueSlipConsumer | null) {
  await refreshProjection();
  const bridge = await connectInMemory(DB_PATH, slip);
  try {
    const llm = new FallbackLlmClient();
    const answer = await runAnalystQuery(question, llm, bridge);
    return answer;
  } finally {
    await bridge.close();
  }
}

export function createAnalystServer(): Server {
  const slipConfig = loadTissueSlipConfig();
  const slip = slipConfig ? new TissueSlipConsumer(slipConfig) : null;
  let activeChats = 0;
  const recentChats: number[] = [];
  const counters = { succeeded: 0, failed: 0, rateLimited: 0, fallbacks: 0 };
  const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const realExports = readExportsDir(CORPUS_DIR).filter((entry) => !entry.fixtureId.startsWith("SYN-"));
    const providerConfigured = groqConfig() !== null || dgridConfig() !== null;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      alive: true,
      ready: providerConfigured && realExports.length > 0,
      readOnlyTools: true,
      skills: ANALYST_SKILLS.map((skill) => skill.id),
      tools: TOOLS.map((tool) => tool.name),
      slipConfigured: slip !== null,
      providerConfigured,
      realFixtures: realExports.length,
    }));
    return;
  }
  if (req.method === "GET" && req.url === "/metrics") {
    const body = [
      "# HELP tissue_analyst_requests_total Analyst chat requests by outcome.",
      "# TYPE tissue_analyst_requests_total counter",
      `tissue_analyst_requests_total{outcome="succeeded"} ${counters.succeeded}`,
      `tissue_analyst_requests_total{outcome="failed"} ${counters.failed}`,
      `tissue_analyst_requests_total{outcome="rate_limited"} ${counters.rateLimited}`,
      "# HELP tissue_analyst_fallbacks_total LLM calls that required the fallback provider.",
      "# TYPE tissue_analyst_fallbacks_total counter",
      `tissue_analyst_fallbacks_total ${counters.fallbacks}`,
      "# HELP tissue_analyst_active_chats Current admitted analyst chat requests.",
      "# TYPE tissue_analyst_active_chats gauge",
      `tissue_analyst_active_chats ${activeChats}`,
      "",
    ].join("\n");
    res.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
    return;
  }
  if (req.method === "POST" && req.url === "/chat") {
    if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      res.writeHead(415, { "content-type": "application/json", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: "content-type must be application/json" }));
      return;
    }
    let body = "";
    let bodyBytes = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      bodyBytes += chunk.byteLength;
      if (bodyBytes > MAX_BODY_BYTES) {
        rejected = true;
        res.writeHead(413, { "content-type": "application/json", "x-content-type-options": "nosniff" });
        res.end(JSON.stringify({ error: `request body exceeds ${MAX_BODY_BYTES} bytes` }));
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", async () => {
      if (rejected) return;
      let admitted = false;
      try {
        const { question } = JSON.parse(body || "{}") as { question?: string };
        if (typeof question !== "string" || !question.trim()) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "missing 'question'" }));
          return;
        }
        const normalized = question.trim();
        if (normalized.length > MAX_QUESTION_CHARS) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `question exceeds ${MAX_QUESTION_CHARS} characters` }));
          return;
        }
        const now = Date.now();
        while (recentChats.length > 0 && recentChats[0]! <= now - RATE_WINDOW_MS) recentChats.shift();
        if (activeChats >= MAX_CONCURRENT_CHATS || recentChats.length >= MAX_CHATS_PER_MINUTE) {
          counters.rateLimited += 1;
          res.writeHead(429, {
            "content-type": "application/json",
            "retry-after": "60",
            "x-content-type-options": "nosniff",
          });
          res.end(JSON.stringify({ error: "analyst capacity reached; retry later" }));
          return;
        }
        admitted = true;
        activeChats += 1;
        recentChats.push(now);
        const answer = await handleChat(normalized, slip);
        counters.succeeded += 1;
        if (answer.fallbackFired) counters.fallbacks += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
      } catch (err) {
        counters.failed += 1;
        console.error(JSON.stringify({
          event: "analyst.chat_failed",
          error: err instanceof Error ? err.name : "UnknownError",
        }));
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "analyst request failed" }));
      } finally {
        if (admitted) activeChats -= 1;
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

export function analystPort(): number {
  const port = Number(process.env.ANALYST_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`ANALYST_PORT must be an integer from 1 to 65535; received ${JSON.stringify(process.env.ANALYST_PORT)}`);
  }
  return port;
}
