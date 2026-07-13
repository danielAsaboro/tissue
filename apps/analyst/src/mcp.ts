import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  get_recent_decisions: { fixture_id: z.string().optional(), limit: z.number().optional() },
  get_signal_class_stats: { signal_class: z.string().optional(), fixture_id: z.string().optional() },
  query_ledger_by_fixture: { fixture_id: z.string() },
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

async function main(): Promise<void> {
  const { server } = buildMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("[analyst-mcp] tissue-analyst MCP server on stdio (read-only)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
