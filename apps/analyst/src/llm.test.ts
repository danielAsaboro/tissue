import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { FallbackLlmClient, type ProviderConfig } from "./llm.js";

/**
 * Hermetic fallback test: two local HTTP servers stand in for Groq and DGrid — no real
 * network, no keys. Proves the client tries the primary, and on a 429 retries the fallback,
 * and logs which provider actually answered (demo-honest).
 */

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function startServer(status: number, completion?: string): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits += 1;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200 ? JSON.stringify({ choices: [{ message: { role: "assistant", content: completion ?? "ok" } }] }) : JSON.stringify({ error: "rate limited" }));
    });
    servers.push(server);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/v1`, hits: () => hits });
    });
  });
}

function startOversizedServer(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("x".repeat(2_097_153));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`);
    });
  });
}

function cfg(name: string, url: string): ProviderConfig {
  return { name, baseUrl: url, apiKey: "test", model: "test-model" };
}

describe("FallbackLlmClient", () => {
  it("answers from the primary when it succeeds (no fallback)", async () => {
    const primary = await startServer(200, "primary answer");
    const fallback = await startServer(200, "fallback answer");
    const client = new FallbackLlmClient(cfg("groq", primary.url), cfg("dgrid", fallback.url));
    const r = await client.chat([{ role: "user", content: "hi" }], []);
    expect(r.message.content).toBe("primary answer");
    expect(r.provider).toBe("groq");
    expect(client.fallbackFired).toBe(false);
    expect(fallback.hits()).toBe(0);
  });

  it("falls back to DGrid on a 429 and logs the fallback", async () => {
    const primary = await startServer(429);
    const fallback = await startServer(200, "fallback answer");
    const client = new FallbackLlmClient(cfg("groq", primary.url), cfg("dgrid", fallback.url));
    const r = await client.chat([{ role: "user", content: "hi" }], []);
    expect(r.message.content).toBe("fallback answer");
    expect(r.provider).toBe("dgrid");
    expect(client.fallbackFired).toBe(true);
    expect(client.providerLog.at(-1)).toEqual({ provider: "dgrid", fellBack: true });
  });

  it("throws when no provider is configured", async () => {
    const client = new FallbackLlmClient(null, null);
    await expect(client.chat([{ role: "user", content: "hi" }], [])).rejects.toThrow(/No LLM provider/);
  });

  it("rejects oversized provider responses", async () => {
    const url = await startOversizedServer();
    const client = new FallbackLlmClient(cfg("groq", url), null);
    await expect(client.chat([{ role: "user", content: "hi" }], [])).rejects.toThrow(/size limit/);
  });
});
