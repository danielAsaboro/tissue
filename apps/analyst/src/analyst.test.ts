import { describe, expect, it, beforeAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import type { AnalystExport } from "@tissue/shared";
import { materializeExports } from "./materialize.js";
import { ReadOnlyLedgerDb } from "./db.js";
import { TOOL_BY_NAME, TOOLS } from "./tools.js";
import { connectInMemory } from "./mcpBridge.js";
import { runAnalystQuery } from "./agent.js";
import type { ChatResult, LlmClient } from "./llm.js";
import { ANALYST_SKILLS, renderAnalystSkills } from "./skills.js";

function makeExport(): AnalystExport {
  const decision = (seq: number, action: string, radarClass?: string) => ({
    seq,
    triggerMsgId: `m${seq}`,
    triggerHash: `th${seq}`,
    triggerNetwork: "devnet" as const,
    ts: (1000 + seq) as never,
    action: action as never,
    ...(radarClass ? { radarClass: radarClass as never } : {}),
    state: { minute: seq, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, inventory: { bySelection: {}, netUnits: 0 }, exposure: { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 0, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 }, feedGapMs: 0 },
    tissueProb: 6000 as never,
    marketProb: 5500 as never,
    edgeBps: 500,
    intents: [],
    simulated: true,
    prevHash: seq === 0 ? "0".repeat(64) : `hash${seq - 1}`,
    hash: `hash${seq}`,
  });
  return {
    fixtureId: "TEST-FX",
    generatedAtMsgId: "m2",
    decisions: [decision(0, "NO_ACTION"), decision(1, "POST", "late-reaction"), decision(2, "HALT", "unexplained-movement")],
    radarEvents: [
      { marketKey: { market: "1X2" }, triggerEvent: { kind: "goal", msgId: "m1", ts: 1001 as never, minute: 1 }, eventTs: 1001 as never, magnitudeBps: 300 as never, reactionLatencyMs: 4000, signalClass: "late-reaction" },
    ],
    grade: {
      generatedAtMsgId: "m2",
      clv: { n: 3, meanClvBps: 40, medianClvBps: 40, p25Bps: 0, p75Bps: 80, pctPositive: 0.66 },
      brier: { brier: 0.2, reliability: 0.01, resolution: 0.05, uncertainty: 0.25, bins: [] },
      latency: [{ market: "1X2", n: 1, p10Ms: 4000, p50Ms: 4000, p90Ms: 4000 }],
      perClass: [{ signalClass: "late-reaction", n: 1, hitRate: 1, meanClvBps: 55 }],
      pnl: { realizedUnits: 1000, matchedIntents: 1, settlementTxSigs: [], simulated: true },
    },
    finalScore: { home: 2, away: 0 },
  };
}

let dbPath: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "tissue-analyst-"));
  dbPath = join(dir, "analyst.db");
  materializeExports(dbPath, [makeExport()]);
});

describe("read-only BY CONSTRUCTION", () => {
  it("opens the connection read-only — any write throws at the SQLite layer", () => {
    const db = new ReadOnlyLedgerDb(dbPath);
    expect(() => db.attemptRawWrite("INSERT INTO decisions(fixture_id, seq) VALUES ('X', 99)")).toThrow(/readonly/i);
    expect(() => db.attemptRawWrite("DELETE FROM decisions")).toThrow(/readonly/i);
    expect(() => db.attemptRawWrite("UPDATE fixtures SET pnl_units = 0")).toThrow(/readonly/i);
    db.close();
  });

  it("the tool surface has only ledger and on-chain reads, with no write/execute/post authority", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "get_recent_decisions",
      "get_signal_class_stats",
      "inspect_slip_market",
      "list_slip_markets",
      "list_slip_wallet_tickets",
      "query_ledger_by_fixture",
      "verify_slip_market_reference",
    ]);
    for (const t of TOOLS) {
      expect(t.name).not.toMatch(/write|insert|update|delete|post|cancel|execute|trade|order/i);
    }
  });

  it("declares skills that constrain every tool without granting transaction authority", () => {
    const declaredTools = new Set(TOOLS.map((tool) => tool.name));
    expect(ANALYST_SKILLS.map((skill) => skill.id)).toEqual([
      "ledger-forensics",
      "slip-market-intelligence",
      "slip-settlement-audit",
    ]);
    for (const skill of ANALYST_SKILLS) {
      for (const tool of skill.tools) expect(declaredTools.has(tool)).toBe(true);
    }
    expect(renderAnalystSkills()).toContain("pool-derived participation weights");
  });

  it("fails precisely when a Slip tool is called without a configured real boundary", async () => {
    const db = new ReadOnlyLedgerDb(dbPath);
    try {
      const tool = TOOL_BY_NAME.get("list_slip_markets");
      if (!tool) throw new Error("Slip tool missing");
      expect(() => tool.handler({ db, slip: null }, {})).toThrow(/TISSUE_SLIP_RPC_URL/);
    } finally {
      db.close();
    }
  });
});

describe("tools return grounded data", () => {
  it("get_recent_decisions + query_ledger + signal stats read the projection", () => {
    const db = new ReadOnlyLedgerDb(dbPath);
    expect(db.getRecentDecisions("TEST-FX", 2)).toHaveLength(2);
    expect(db.queryLedgerByFixture("TEST-FX")).toHaveLength(3);
    const stats = db.getSignalClassStats(undefined, "TEST-FX");
    const late = stats.find((s) => s.signal_class === "late-reaction");
    expect(late?.n_signals).toBe(1);
    expect(late?.n_decisions).toBe(1);
    db.close();
  });
});

/** Scripted LLM: round 1 calls a tool, round 2 gives a final grounded answer. */
class FakeLlm implements LlmClient {
  calls = 0;
  constructor(private readonly toolName: string, private readonly args: Record<string, unknown>) {}
  async chat(): Promise<ChatResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: this.toolName, arguments: JSON.stringify(this.args) } }] },
        provider: "groq",
        model: "fake",
        fellBack: false,
      };
    }
    return {
      message: { role: "assistant", content: "The desk HALTed on unexplained movement at seq 2." },
      provider: "groq",
      model: "fake",
      fellBack: false,
    };
  }
}

describe("agent — LLM + MCP tool loop", () => {
  it("drives a read-only tool through MCP and returns a grounded answer with citations", async () => {
    const bridge = await connectInMemory(dbPath);
    try {
      const llm = new FakeLlm("query_ledger_by_fixture", { fixture_id: "TEST-FX" });
      const ans = await runAnalystQuery("What did the desk do on TEST-FX?", llm, bridge);
      expect(ans.answer).toContain("HALT");
      expect(ans.toolCalls[0]!.name).toBe("query_ledger_by_fixture");
      expect(ans.citations.length).toBe(3); // three ledger rows cited (seq+hash)
      expect(ans.citations[0]).toHaveProperty("hash");
      expect(ans.providers[0]!.provider).toBe("groq");
    } finally {
      await bridge.close();
    }
  });
});

describe("STATELESS w.r.t. decisioning — narration never becomes a trade", () => {
  it("running the analyst never mutates the ledger DB and produces zero trades", async () => {
    const before = readFileSync(dbPath);
    const mtimeBefore = statSync(dbPath).mtimeMs;

    const bridge = await connectInMemory(dbPath);
    try {
      const llm = new FakeLlm("get_recent_decisions", { fixture_id: "TEST-FX", limit: 3 });
      const a1 = await runAnalystQuery("summarize", llm, bridge);
      const llm2 = new FakeLlm("get_recent_decisions", { fixture_id: "TEST-FX", limit: 3 });
      const a2 = await runAnalystQuery("summarize", llm2, bridge);

      // The read-model bytes are unchanged — the analyst wrote nothing, twice.
      expect(readFileSync(dbPath).equals(before)).toBe(true);
      expect(statSync(dbPath).mtimeMs).toBe(mtimeBefore);

      // The answer object has NO trade/intent/decision surface — narration only.
      for (const ans of [a1, a2]) {
        expect(ans).not.toHaveProperty("intents");
        expect(ans).not.toHaveProperty("trades");
        expect(Object.keys(ans).sort()).toEqual(["answer", "citations", "fallbackFired", "providers", "toolCalls"]);
      }
    } finally {
      await bridge.close();
    }
  });
});
