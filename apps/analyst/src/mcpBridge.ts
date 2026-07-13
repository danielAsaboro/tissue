import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./mcp.js";
import { TOOLS } from "./tools.js";
import type { ToolSpec } from "./llm.js";

/**
 * In-memory MCP bridge: links a real MCP Client to the real MCP server over a linked
 * transport pair, in-process (no subprocess). The agent's LLM loop calls tools THROUGH this
 * bridge — a genuine LLM+MCP tool loop — while the tool implementations remain the same
 * read-only handlers the stdio server exposes.
 */

export interface McpBridge {
  toolSpecs(): ToolSpec[];
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

/** OpenAI-style tool specs derived from the shared TOOLS (JSON-schema params). */
export function toolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export async function connectInMemory(dbPath?: string): Promise<McpBridge> {
  const { server, db } = buildMcpServer(dbPath);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tissue-analyst-agent", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    toolSpecs,
    async callTool(name, args) {
      const res = (await client.callTool({ name, arguments: args })) as {
        content?: { type: string; text?: string }[];
      };
      return (res.content ?? []).map((c) => c.text ?? "").join("");
    },
    async close() {
      await client.close();
      db.close();
    },
  };
}
