import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { ReadOnlyLedgerDb } from "./db.js";
import { TOOL_BY_NAME } from "./tools.js";
import { DB_PATH } from "./paths.js";

/**
 * MCP server exposing the three READ-ONLY analyst tools. Every tool reads through a
 * ReadOnlyLedgerDb (connection opened read-only). No write tools are registered — the server
 * surface is read-only by construction. Runnable over stdio for external MCP clients; the
 * agent links to the same server in-memory (mcpBridge.ts). One handler implementation
 * (tools.ts) backs both.
 */

const INPUT_SHAPES: Record<string, ZodRawShape> = {
  get_recent_decisions: { fixture_id: z.string().max(128).optional(), limit: z.number().int().min(1).max(200).optional() },
  get_signal_class_stats: { signal_class: z.string().max(64).optional(), fixture_id: z.string().max(128).optional() },
  query_ledger_by_fixture: { fixture_id: z.string().min(1).max(128) },
};

export function buildMcpServer(dbPath: string = DB_PATH): { server: McpServer; db: ReadOnlyLedgerDb } {
  const db = new ReadOnlyLedgerDb(dbPath);
  const server = new McpServer({ name: "tissue-analyst", version: "0.1.0" });

  for (const [name, tool] of TOOL_BY_NAME) {
    server.registerTool(
      name,
      { description: tool.description, inputSchema: INPUT_SHAPES[name] ?? {} },
      async (args: Record<string, unknown>) => {
        const result = tool.handler(db, args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
  return { server, db };
}
