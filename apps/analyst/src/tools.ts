import type { ReadOnlyLedgerDb } from "./db.js";

/**
 * The three (and only three) read-only analyst tools. Each is a pure read over the
 * read-only DB. There is deliberately NO write/post/execute tool — the analyst narrates
 * already-decided data, it never decides. These same definitions back both the MCP server
 * (mcp.ts) and the in-process agent loop (agent.ts), so there is one implementation.
 */

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
    additionalProperties: false;
  };
  readonly handler: (db: ReadOnlyLedgerDb, args: Record<string, unknown>) => unknown;
}

/** Citations the agent surfaces: the exact ledger rows a tool result pulled. */
export interface ToolResult {
  readonly rows: unknown[];
  readonly citations: { seq: number; hash: string; fixtureId: string }[];
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "get_recent_decisions",
    description:
      "Return the most recent decision-ledger records (optionally for one fixture). Each row is an already-hash-chained decision: action (POST/NO_ACTION/HALT), radar class, edge, score, and hash. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        fixture_id: { type: "string", description: "Optional fixture id to filter by (maximum 128 characters)." },
        limit: { type: "integer", description: "Max rows (1-200, default 20)." },
      },
      additionalProperties: false,
    },
    handler: (db, args) => {
      const rows = db.getRecentDecisions(
        typeof args.fixture_id === "string" ? args.fixture_id : undefined,
        typeof args.limit === "number" ? args.limit : 20,
      );
      return withCitations(rows);
    },
  },
  {
    name: "get_signal_class_stats",
    description:
      "Aggregate Latency-Radar signal-class stats: per class, the count of radar events, mean reaction latency and magnitude, number of decisions taken under that class, and (from the grade sheet) hit rate and mean CLV. Optionally filter by class and/or fixture. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        signal_class: { type: "string", description: "Optional radar class, e.g. 'late-reaction', 'unexplained-movement'." },
        fixture_id: { type: "string", description: "Optional fixture id to filter by." },
      },
      additionalProperties: false,
    },
    handler: (db, args) => {
      const rows = db.getSignalClassStats(
        typeof args.signal_class === "string" ? args.signal_class : undefined,
        typeof args.fixture_id === "string" ? args.fixture_id : undefined,
      );
      return { rows, citations: [] as { seq: number; hash: string; fixtureId: string }[] };
    },
  },
  {
    name: "query_ledger_by_fixture",
    description:
      "Return up to the 500 most recent decision-ledger records for one fixture, ordered by sequence and including the hash chain. Read-only. Use to walk what the desk did and cite specific decisions.",
    inputSchema: {
      type: "object",
      properties: { fixture_id: { type: "string", description: "The fixture id (required)." } },
      required: ["fixture_id"],
      additionalProperties: false,
    },
    handler: (db, args) => {
      const fixtureId = String(args.fixture_id ?? "");
      return withCitations(db.queryLedgerByFixture(fixtureId));
    },
  },
];

function withCitations(rows: { seq: number; hash: string; fixture_id: string }[]): ToolResult {
  return {
    rows,
    citations: rows.map((r) => ({ seq: r.seq, hash: r.hash, fixtureId: r.fixture_id })),
  };
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
