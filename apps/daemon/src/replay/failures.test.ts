import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { runEngine, type SubmitOutcome } from "./engine.js";
import { grade } from "../grader/grader.js";
import {
  type FeedMessage,
  type OddsMessage,
  type ScoreMessage,
  bps,
  millis,
  type ProbVector,
} from "@tissue/shared";
import { STATUS } from "../ingest/soccerFeed.js";

/**
 * E2E failure-path tests (PRD §3 failure branches). Each builds a targeted corpus and runs it
 * through the REAL engine, asserting the desk's failure behavior end-to-end — not just units.
 */

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

const B = 1_720_000_000_000;

function score(
  id: string, min: number, h: number, a: number,
  o: { status?: number; final?: boolean; void?: boolean; awayReds?: number } = {},
): ScoreMessage {
  return {
    kind: "score", msgId: id, fixtureId: "FAIL", ts: millis(B + min * 60_000), network: "devnet",
    minute: min, homeScore: h, awayScore: a, homeReds: 0, awayReds: o.awayReds ?? 0,
    possession: { home: "none", away: "none" }, phase: String(o.status ?? STATUS.H2),
    isFinal: Boolean(o.final), isVoid: Boolean(o.void),
  };
}

function odds(id: string, min: number, H: number, D: number, A: number): OddsMessage {
  return {
    kind: "odds", msgId: id, fixtureId: "FAIL", ts: millis(B + min * 60_000 + 1000), network: "devnet",
    marketKey: { market: "1X2" }, consensus: { HOME: bps(H), DRAW: bps(D), AWAY: bps(A) } as ProbVector,
    rawOdds: {}, inRunning: true,
  };
}
function totals(id: string, min: number, over: number, under: number): OddsMessage {
  return {
    kind: "odds", msgId: id, fixtureId: "FAIL", ts: millis(B + min * 60_000 + 2000), network: "devnet",
    marketKey: { market: "TOTALS", lineTimes10: 25 }, consensus: { OVER: bps(over), UNDER: bps(under) } as ProbVector,
    rawOdds: {}, inRunning: true,
  };
}

describe("failure: abandoned/cancelled match ⇒ VOID (no settle on phantom score)", () => {
  it("halts, voids settlement, and books zero PnL", () => {
    const corpus: FeedMessage[] = [
      score("s0", 0, 0, 0, { status: STATUS.H1 }), odds("o0", 0, 5000, 3000, 2000), totals("t0", 0, 5200, 4800),
      score("s1", 40, 1, 0), odds("o1", 41, 6600, 2300, 1100), totals("t1", 41, 5500, 4500),
      score("s2", 55, 1, 0, { status: STATUS.ABANDONED, void: true }),
    ];
    const r = runEngine(corpus, policy);
    expect(r.voided).toBe(true);
    // No phantom settlement on the 1-0 — PnL is voided to zero, in both the result and the grade.
    expect(r.book.settle(r.finalScore.home, r.finalScore.away).totalPnlUnits).not.toBe(0); // (the sim book still CAN compute a score PnL...)
    expect(grade(r, policy).pnl.realizedUnits).toBe(0); // ...but the desk books ZERO because it voided.
    // Last decision is a HALT for match-void; no open intents remain.
    const last = r.ledger.all().at(-1)!;
    expect(last.action).toBe("HALT");
    expect(last.haltReason).toBe("match-void");
    expect(r.book.openIntents()).toHaveLength(0);
  });
});

describe("failure: VAR score reversal ⇒ explained, NOT a false unexplained HALT", () => {
  it("emits a score_correction event and fires no unexplained-movement halt", () => {
    // Goal at 40' (1-0), reverted by VAR at 42' (0-0); the market snaps back — a big move.
    const corpus: FeedMessage[] = [
      score("v0", 0, 0, 0, { status: STATUS.H1 }), odds("vo0", 0, 5000, 3000, 2000),
      score("v1", 40, 1, 0, { status: STATUS.H1 }), odds("vo1", 40, 6800, 2200, 1000),
      score("v2", 42, 0, 0, { status: STATUS.H1 }), odds("vo2", 42, 5000, 3000, 2000),
      score("v3", 90, 0, 0, { final: true }),
    ];
    const r = runEngine(corpus, policy);
    const corrections = r.radarEvents.filter((e) => e.triggerEvent.kind === "score_correction");
    expect(corrections.length).toBeGreaterThanOrEqual(1);
    expect(r.halts.filter((h) => h.reason === "unexplained-movement")).toHaveLength(0);
  });
});

describe("failure: model divergence (tissue vs stale market) ⇒ pull + flag", () => {
  it("halts the market with reason model-divergence when the market is stale vs tissue", () => {
    // Market opens balanced then goes STALE while goals+red pile up → tissue races away from it.
    const corpus: FeedMessage[] = [
      score("m0", 0, 0, 0, { status: STATUS.H1 }), odds("mo0", 0, 5000, 3000, 2000), totals("mt0", 0, 5200, 4800),
      score("m1", 85, 3, 0, { awayReds: 1 }), odds("mo1", 85, 5000, 3000, 2000), totals("mt1", 85, 5200, 4800),
    ];
    const r = runEngine(corpus, policy);
    const flagged = r.ledger.all().some((d) => d.haltReason === "model-divergence");
    expect(flagged).toBe(true);
  });
});

describe("failure: tx-failure and devnet congestion ⇒ market halt (fee ladder)", () => {
  const base: FeedMessage[] = [
    score("c0", 0, 0, 0, { status: STATUS.H1 }), odds("co0", 0, 5000, 3000, 2000), totals("ct0", 0, 5200, 4800),
    score("c1", 30, 0, 0, { status: STATUS.H1 }), odds("co1", 30, 4200, 3000, 2800), totals("ct1", 30, 5000, 5000),
    score("c2", 55, 1, 0), odds("co2", 55, 6600, 2300, 1100), totals("ct2", 55, 5500, 4500),
    score("c3", 70, 1, 0), odds("co3", 70, 6800, 2200, 1000), totals("ct3", 70, 5600, 4400),
  ];

  it("repeated tx failures on a market halt it (tx-failure)", () => {
    const alwaysFail: SubmitOutcome = "failed";
    const r = runEngine(base, policy, "devnet", { submitFault: () => alwaysFail });
    expect(r.ledger.all().some((d) => d.haltReason === "tx-failure")).toBe(true);
  });

  it("sustained congestion exhausts the fee ladder and halts the market (congestion)", () => {
    const r = runEngine(base, policy, "devnet", { submitFault: () => "congested" });
    expect(r.ledger.all().some((d) => d.haltReason === "congestion")).toBe(true);
  });

  it("no fault ⇒ the desk posts normally (control)", () => {
    const r = runEngine(base, policy);
    expect(r.ledger.all().some((d) => d.action === "POST")).toBe(true);
    expect(r.ledger.all().some((d) => d.haltReason === "tx-failure" || d.haltReason === "congestion")).toBe(false);
  });
});
