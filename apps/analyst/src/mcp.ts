import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { ReadOnlyLedgerDb } from "./db.js";
import { TOOL_BY_NAME } from "./tools.js";
import { DB_PATH } from "./paths.js";
import type { TissueSlipConsumer } from "@tissue/slip";

/**
 * MCP server exposing ledger and Slip READ-ONLY tools. Ledger access uses a read-only SQLite
 * connection; Slip access uses the packed SDK's verified RPC readers. No transaction tool is
 * registered. One handler implementation backs stdio and the in-memory agent bridge.
 */

const INPUT_SHAPES: Record<string, ZodRawShape> = {
  get_recent_decisions: { fixture_id: z.string().max(128).optional(), limit: z.number().int().min(1).max(200).optional() },
  get_signal_class_stats: { signal_class: z.string().max(64).optional(), fixture_id: z.string().max(128).optional() },
  query_ledger_by_fixture: { fixture_id: z.string().min(1).max(128) },
  find_similar_decisions: {
    fixture_id: z.string().min(1).max(128),
    seq: z.number().int().min(0),
    minute_tolerance: z.number().int().min(0).max(200).optional(),
    edge_tolerance_bps: z.number().int().min(0).max(100_000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  list_slip_markets: {
    fixture_id: z.string().regex(/^[1-9]\d{0,18}$/).optional(),
    status: z.enum(["open", "resolved", "voided"]).optional(),
    stake: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/).optional(),
  },
  inspect_slip_market: {
    market_address: z.string().min(32).max(44),
    stake: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/).optional(),
  },
  verify_slip_market_reference: {
    network: z.enum(["localnet", "devnet", "mainnet-beta"]),
    program: z.string().min(32).max(44),
    mint: z.string().min(32).max(44),
    market: z.string().min(32).max(44),
    fixture_id: z.string().regex(/^[1-9]\d{0,18}$/),
    rulebook_hash: z.string().regex(/^[a-f0-9]{64}$/),
    creation_signature: z.string().min(64).max(128),
  },
  list_slip_wallet_tickets: { owner: z.string().min(32).max(44).optional() },
};

export function buildMcpServer(
  dbPath: string = DB_PATH,
  slip: TissueSlipConsumer | null = null,
): { server: McpServer; db: ReadOnlyLedgerDb } {
  const db = new ReadOnlyLedgerDb(dbPath);
  const server = new McpServer({ name: "tissue-analyst", version: "0.1.0" });

  for (const [name, tool] of TOOL_BY_NAME) {
    server.registerTool(
      name,
      { description: tool.description, inputSchema: INPUT_SHAPES[name] ?? {} },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler({ db, slip }, args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
  return { server, db };
}
