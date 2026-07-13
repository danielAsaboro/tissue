import { describe, expect, it } from "vitest";
import { SimulatedBook, crosses } from "./simulatedBook.js";
import { FeeLadder } from "./feeLadder.js";
import { deriveDailyOddsRootPda, deriveDailyScoresRootPda, epochDayFromTs, prepareOddsAnchor } from "./anchor.js";
import type { QuoteProposal } from "../strategy/strategy.js";
import type { ExternalIntent } from "./port.js";
import { isConfirmedSignature, toBytes32 } from "./anchorLive.js";
import { assertScoreProofMatchesMessage, type ScoreStatProofResponse } from "./scoreAnchorLive.js";
import { millis, type ScoreMessage } from "@tissue/shared";

function proposal(side: "BACK" | "LAY", priceMilliOdds: number, sizeUnits: number): QuoteProposal {
  return { marketKey: { market: "1X2" }, selection: "HOME", side, priceMilliOdds, sizeUnits, edgeBps: 300, radarClass: undefined, reason: "test" };
}
function external(side: "BACK" | "LAY", priceMilliOdds: number, sizeUnits: number, owner = "counterparty"): ExternalIntent {
  return { owner, marketKey: { market: "1X2" }, selection: "HOME", side, priceMilliOdds, sizeUnits };
}

describe("simulated book — labeling", () => {
  it("marks every intent and fill as simulated", () => {
    const book = new SimulatedBook();
    expect(book.simulated).toBe(true);
    const i = book.postIntent(proposal("BACK", 2100, 100), "F", "m1");
    expect(i.simulated).toBe(true);
    const fills = book.submitExternal(external("LAY", 2000, 100));
    expect(fills.every((f) => f.simulated)).toBe(true);
  });

  it("publishes quotes without inventing fills when matching simulation is disabled", () => {
    const book = new SimulatedBook(false);
    const quote = book.postIntent(proposal("BACK", 2100, 100), "F", "m1");
    expect(book.simulated).toBe(false);
    expect(quote.id.startsWith("QUOTE:")).toBe(true);
    expect(quote.simulated).toBe(false);
    expect(book.submitExternal(external("LAY", 2000, 100))).toEqual([]);
    expect(book.settle(2, 0)).toEqual({ perIntentPnlUnits: {}, totalPnlUnits: 0, simulated: false });
  });
});

describe("solver rules", () => {
  it("crosses opposite sides at the maker's resting odds", () => {
    expect(crosses("BACK", 2100, "LAY", 2000)).toBe(true); // taker lays ≤ 2.10
    expect(crosses("BACK", 2100, "LAY", 2200)).toBe(false);
    expect(crosses("LAY", 1900, "BACK", 2000)).toBe(true);
    expect(crosses("BACK", 2000, "BACK", 2000)).toBe(false); // same side never
  });

  it("matches external against Tissue's resting intent and updates status", () => {
    const book = new SimulatedBook();
    book.postIntent(proposal("BACK", 2100, 100), "F", "m1");
    const fills = book.submitExternal(external("LAY", 2050, 60));
    expect(fills).toHaveLength(1);
    expect(fills[0]!.sizeUnits).toBe(60);
    const open = book.openIntents();
    expect(open[0]!.status).toBe("PartiallyMatched");
    expect(open[0]!.filledUnits).toBe(60);
  });

  it("never self-matches (external owned by tissue is ignored)", () => {
    const book = new SimulatedBook();
    book.postIntent(proposal("BACK", 2100, 100), "F", "m1");
    expect(book.submitExternal(external("LAY", 2000, 100, "tissue"))).toHaveLength(0);
  });

  it("never matches external-vs-external (no Tissue intent ⇒ no fill)", () => {
    const book = new SimulatedBook();
    expect(book.submitExternal(external("LAY", 2000, 100))).toHaveLength(0);
  });

  it("cancel removes an intent from the book", () => {
    const book = new SimulatedBook();
    const i = book.postIntent(proposal("BACK", 2100, 100), "F", "m1");
    book.cancelIntent(i.id);
    expect(book.openIntents()).toHaveLength(0);
    expect(book.submitExternal(external("LAY", 2000, 100))).toHaveLength(0);
  });
});

describe("settlement (simulated PnL)", () => {
  it("BACK on HOME wins at odds when home wins; loses stake otherwise", () => {
    const book = new SimulatedBook();
    book.postIntent(proposal("BACK", 2000, 100), "F", "m1");
    book.submitExternal(external("LAY", 2000, 100));
    const win = book.settle(2, 0);
    expect(win.totalPnlUnits).toBe(100); // stake 100 × (2.0−1)
    expect(win.simulated).toBe(true);

    const book2 = new SimulatedBook();
    book2.postIntent(proposal("BACK", 2000, 100), "F", "m1");
    book2.submitExternal(external("LAY", 2000, 100));
    expect(book2.settle(0, 1).totalPnlUnits).toBe(-100);
  });
});

describe("fee ladder", () => {
  it("escalates then halts (null) when exhausted", () => {
    const l = new FeeLadder([0, 1000, 10000, 50000], 3);
    expect(l.current()).toBe(0);
    expect(l.escalate()).toBe(1000);
    expect(l.escalate()).toBe(10000);
    expect(l.escalate()).toBe(50000);
    expect(l.escalate()).toBeNull(); // exhausted → caller halts market
    expect(l.exhausted).toBe(true);
  });
});

describe("validate_odds anchoring (real derivation)", () => {
  it("computes epochDay from the record ts, not the clock", () => {
    expect(epochDayFromTs(1_720_000_000_000)).toBe(Math.floor(1_720_000_000_000 / 86_400_000));
    expect(() => epochDayFromTs(-1)).toThrow("non-negative safe integer");
  });
  it("derives a deterministic PDA on devnet", () => {
    const a = deriveDailyOddsRootPda("devnet", 19907);
    const b = deriveDailyOddsRootPda("devnet", 19907);
    expect(a.pda.toBase58()).toBe(b.pda.toBase58());
    expect(a.pda.toBase58()).not.toBe(deriveDailyOddsRootPda("devnet", 19908).pda.toBase58());
  });
  it("rejects epoch days that would wrap the u16 PDA seed", () => {
    expect(() => deriveDailyOddsRootPda("devnet", 65_536)).toThrow("fit in u16");
  });
  it("prepares an anchor with programId + root PDA, marked not-yet-submitted", () => {
    const p = prepareOddsAnchor("devnet", 1_720_000_000_000);
    expect(p.programId).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(p.rootPda.length).toBeGreaterThan(30);
    expect(p.submitted).toBe(false);
  });
  it("strictly decodes base64 and byte-array Merkle hashes", () => {
    const bytes = Array.from({ length: 32 }, (_, i) => i);
    expect(toBytes32(bytes)).toEqual(bytes);
    expect(toBytes32(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
    expect(() => toBytes32([1, 2, 3])).toThrow("32");
    expect(() => toBytes32([...bytes.slice(0, 31), 256])).toThrow("0 through 255");
    expect(() => toBytes32("!".repeat(44))).toThrow("canonical");
  });
  it("never treats a missing or merely processed signature as confirmed", () => {
    expect(isConfirmedSignature(null)).toBe(false);
    expect(isConfirmedSignature({ err: null, slot: 10, confirmationStatus: "processed" })).toBe(false);
    expect(isConfirmedSignature({ err: { custom: 1 }, slot: 10, confirmationStatus: "confirmed" })).toBe(false);
    expect(isConfirmedSignature({ err: null, slot: 10, confirmationStatus: "confirmed" })).toBe(true);
    expect(isConfirmedSignature({ err: null, slot: 10, confirmationStatus: "finalized" })).toBe(true);
  });
});

describe("validate_stat source binding", () => {
  const score: ScoreMessage = {
    kind: "score",
    msgId: "score-7",
    fixtureId: "18237038",
    sourceSeq: 7,
    ts: millis(1_783_999_920_000),
    network: "devnet",
    minute: 46,
    homeScore: 1,
    awayScore: 0,
    homeReds: 0,
    awayReds: 0,
    possession: { home: "none", away: "none" },
    phase: "4",
    isFinal: false,
    isVoid: false,
  };
  const bytes = Array.from({ length: 32 }, (_, index) => index);
  const proof: ScoreStatProofResponse = {
    statToProve: { key: 1, value: 1, period: 4 },
    eventStatRoot: bytes,
    statProof: [],
    subTreeProof: [],
    mainTreeProof: [],
    summary: {
      fixtureId: 18_237_038,
      updateStats: {
        updateCount: 3,
        minTimestamp: 1_783_999_900_000,
        maxTimestamp: 1_783_999_940_000,
      },
      eventStatsSubTreeRoot: bytes,
    },
  };

  it("derives the documented daily scores PDA independently of the odds PDA", () => {
    const day = epochDayFromTs(score.ts);
    const scores = deriveDailyScoresRootPda("devnet", day).pda.toBase58();
    const odds = deriveDailyOddsRootPda("devnet", day).pda.toBase58();
    expect(scores).not.toBe(odds);
    expect(scores).toBe(deriveDailyScoresRootPda("devnet", day).pda.toBase58());
  });

  it("accepts a strictly matching fixture, stat, value, period, and batch window", () => {
    expect(assertScoreProofMatchesMessage(score, proof, 1, 1)).toEqual({
      proofTs: 1_783_999_900_000,
      period: 4,
    });
  });

  it("rejects a proof replayed across a fixture, value, period, or timestamp", () => {
    expect(() => assertScoreProofMatchesMessage(score, { ...proof, summary: { ...proof.summary, fixtureId: 1 } }, 1, 1)).toThrow("fixture ID");
    expect(() => assertScoreProofMatchesMessage(score, { ...proof, statToProve: { ...proof.statToProve, value: 2 } }, 1, 1)).toThrow("does not match streamed value");
    expect(() => assertScoreProofMatchesMessage(score, { ...proof, statToProve: { ...proof.statToProve, period: 2 } }, 1, 1)).toThrow("streamed phase");
    expect(() => assertScoreProofMatchesMessage({ ...score, ts: millis(1_784_000_000_000) }, proof, 1, 1)).toThrow("outside its anchored batch");
  });
});
