import type { ReadOnlyLedgerDb } from "./db.js";
import type { TissueSlipConsumer } from "@tissue/slip";

/**
 * Read-only analyst tools. Ledger tools read the immutable projection; Slip tools read
 * verified on-chain accounts through the packed public SDK. There is deliberately NO
 * write/post/execute tool. These same definitions back MCP and the in-process agent loop.
 */

export interface ToolRuntime {
  readonly db: ReadOnlyLedgerDb;
  readonly slip: TissueSlipConsumer | null;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
    additionalProperties: false;
  };
  readonly handler: (runtime: ToolRuntime, args: Record<string, unknown>) => unknown | Promise<unknown>;
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
    handler: ({ db }, args) => {
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
    handler: ({ db }, args) => {
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
    handler: ({ db }, args) => {
      const fixtureId = String(args.fixture_id ?? "");
      return withCitations(db.queryLedgerByFixture(fixtureId));
    },
  },
  {
    name: "find_similar_decisions",
    description:
      "Find past decisions structurally similar to a reference decision — same radar class (or same action when the reference has none), match-minute within tolerance, and edge magnitude within tolerance, ranked by combined distance. This is structured pattern recall, not embeddings-based semantic search — every result is a real, citable ledger row, not a fabricated similarity score. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        fixture_id: { type: "string", description: "Fixture id of the reference decision (required)." },
        seq: { type: "integer", description: "Sequence number of the reference decision within that fixture (required)." },
        minute_tolerance: { type: "integer", description: "Match-minute tolerance in minutes (default 10)." },
        edge_tolerance_bps: { type: "integer", description: "Edge magnitude tolerance in bps (default 100)." },
        limit: { type: "integer", description: "Max rows (1-50, default 10)." },
      },
      required: ["fixture_id", "seq"],
      additionalProperties: false,
    },
    handler: ({ db }, args) => {
      const rows = db.findSimilarDecisions(String(args.fixture_id ?? ""), Number(args.seq), {
        ...(typeof args.minute_tolerance === "number" ? { minuteToleranceMin: args.minute_tolerance } : {}),
        ...(typeof args.edge_tolerance_bps === "number" ? { edgeToleranceBps: args.edge_tolerance_bps } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
      return withCitations(rows);
    },
  },
  {
    name: "list_slip_markets",
    description:
      "List verified Slip markets from the configured Solana program, optionally filtered by TxLINE fixture or on-chain status. Returns pool-derived probabilities, fees, payout projection, canonical Rulebook hash, and settlement state. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        fixture_id: { type: "string", description: "Optional numeric TxLINE fixture id." },
        status: { type: "string", description: "Optional status: open, resolved, or voided." },
        stake: { type: "string", description: "Optional six-decimal stake used only for projected payouts (default 1)." },
      },
      additionalProperties: false,
    },
    handler: ({ slip }, args) => requireSlip(slip).listMarkets({
      ...(typeof args.fixture_id === "string" ? { fixtureId: args.fixture_id } : {}),
      ...(args.status === "open" || args.status === "resolved" || args.status === "voided" ? { status: args.status } : {}),
      ...(typeof args.stake === "string" ? { stake: args.stake } : {}),
    }),
  },
  {
    name: "inspect_slip_market",
    description:
      "Read and verify one canonical Slip market PDA, then return its Rulebook, live pools, implied probabilities, fee/tip/dust inputs, status, result, and projected payouts. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        market_address: { type: "string", description: "Slip market account address." },
        stake: { type: "string", description: "Optional six-decimal stake used only for projected payouts (default 1)." },
      },
      required: ["market_address"],
      additionalProperties: false,
    },
    handler: ({ slip }, args) => requireSlip(slip).inspectMarket(
      String(args.market_address ?? ""),
      typeof args.stake === "string" ? args.stake : undefined,
    ),
  },
  {
    name: "verify_slip_market_reference",
    description:
      "Verify a closed Slip market reference against configured network, program, mint, canonical market PDA, account owner, fixture, Rulebook hash, and creation transaction. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        network: { type: "string", description: "localnet, devnet, or mainnet-beta." },
        program: { type: "string", description: "Slip program address." },
        mint: { type: "string", description: "Settlement mint address." },
        market: { type: "string", description: "Market account address." },
        fixture_id: { type: "string", description: "Numeric TxLINE fixture id." },
        rulebook_hash: { type: "string", description: "Canonical SHA-256 Rulebook hash." },
        creation_signature: { type: "string", description: "Confirmed create-market transaction signature." },
      },
      required: ["network", "program", "mint", "market", "fixture_id", "rulebook_hash", "creation_signature"],
      additionalProperties: false,
    },
    handler: ({ slip }, args) => requireSlip(slip).verifyReference({
      version: 1,
      network: args.network,
      program: args.program,
      mint: args.mint,
      market: args.market,
      fixtureId: args.fixture_id,
      rulebookHash: args.rulebook_hash,
      creationSignature: args.creation_signature,
    }),
  },
  {
    name: "list_slip_wallet_tickets",
    description:
      "List canonical Slip tickets owned by a wallet, including market, outcome, exact six-decimal stake, nonce, and claimed state. Uses the configured watch wallet when owner is omitted. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Optional Solana wallet address; defaults to TISSUE_SLIP_WALLET." },
      },
      additionalProperties: false,
    },
    handler: ({ slip }, args) => requireSlip(slip).listWalletTickets(
      typeof args.owner === "string" ? args.owner : undefined,
    ),
  },
];

function requireSlip(slip: TissueSlipConsumer | null): TissueSlipConsumer {
  if (!slip) {
    throw new Error(
      "Slip market tools are unavailable: configure TISSUE_SLIP_RPC_URL, TISSUE_SLIP_PROGRAM_ID, and TISSUE_SLIP_SETTLEMENT_MINT",
    );
  }
  return slip;
}

function withCitations(rows: { seq: number; hash: string; fixture_id: string }[]): ToolResult {
  return {
    rows,
    citations: rows.map((r) => ({ seq: r.seq, hash: r.hash, fixtureId: r.fixture_id })),
  };
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
