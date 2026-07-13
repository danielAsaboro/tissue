import { createServer } from "node:http";
import { connectInMemory } from "./mcpBridge.js";
import { FallbackLlmClient } from "./llm.js";
import { runAnalystQuery } from "./agent.js";
import { DB_PATH } from "./paths.js";

/**
 * Tiny HTTP surface for the dashboard's "ask Tissue" panel: POST /chat { question } → grounded
 * answer + ledger citations + provider metadata. Runs the LLM+MCP tool loop server-side. This
 * process is fully isolated from the decision path — it holds only a READ-ONLY DB handle.
 *
 *   pnpm --filter @tissue/analyst serve   (PORT, default 8787)
 */

const PORT = Number(process.env.ANALYST_PORT ?? 8787);

async function handleChat(question: string) {
  const bridge = await connectInMemory(DB_PATH);
  try {
    const llm = new FallbackLlmClient();
    const answer = await runAnalystQuery(question, llm, bridge);
    return answer;
  } finally {
    await bridge.close();
  }
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, readOnly: true, db: DB_PATH }));
    return;
  }
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { question } = JSON.parse(body || "{}") as { question?: string };
        if (!question || typeof question !== "string") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "missing 'question'" }));
          return;
        }
        const answer = await handleChat(question);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.error(`[analyst] read-only analyst service on :${PORT} (POST /chat)`);
});
