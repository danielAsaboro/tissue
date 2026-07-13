import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createAnalystServer } from "./server.js";

const servers: Server[] = [];

async function bind(): Promise<string> {
  const server = createAnalystServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("analyst test server did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("analyst HTTP boundary", () => {
  it("requires JSON for chat requests", async () => {
    const origin = await bind();
    const response = await fetch(`${origin}/chat`, { method: "POST", body: "question=hello" });
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: "content-type must be application/json" });
  });

  it("rejects oversized bodies before invoking the analyst", async () => {
    const origin = await bind();
    const response = await fetch(`${origin}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x".repeat(9_000) }),
    });
    expect(response.status).toBe(413);
  });

  it("rejects questions over the semantic limit", async () => {
    const origin = await bind();
    const response = await fetch(`${origin}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x".repeat(1_001) }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "question exceeds 1000 characters" });
  });

  it("does not expose internal failure details", async () => {
    const origin = await bind();
    const response = await fetch(`${origin}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "summarize" }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "analyst request failed" });
  });

  it("rate-limits analyst requests before they can create unbounded provider spend", async () => {
    const origin = await bind();
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${origin}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: `question ${i}` }),
      });
      expect(response.status).toBe(500);
    }
    const limited = await fetch(`${origin}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "one too many" }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    const metrics = await fetch(`${origin}/metrics`).then((response) => response.text());
    expect(metrics).toContain('tissue_analyst_requests_total{outcome="failed"} 30');
    expect(metrics).toContain('tissue_analyst_requests_total{outcome="rate_limited"} 1');
  });
});
