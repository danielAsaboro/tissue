import { describe, expect, it } from "vitest";
import { SseFrameParser } from "./sseParser.js";
import { FeedHealthTracker } from "./feedHealth.js";
import { normalizeOdds, normalizeScores } from "./normalize.js";
import { generateSyntheticCorpus } from "./synthetic.js";
import { PERIOD_PREFIX, STAT_KEY, STATUS } from "./soccerFeed.js";
import { parseActivationToken } from "./txlineAuth.js";
import { parseJsonSse } from "./sse.js";

describe("TxLINE auth response compatibility", () => {
  it("accepts the live plain-text token and documented JSON shapes", () => {
    expect(parseActivationToken("txoracle_api_live\n")).toBe("txoracle_api_live");
    expect(parseActivationToken('{"token":"txoracle_api_json"}')).toBe("txoracle_api_json");
    expect(parseActivationToken('"txoracle_api_string"')).toBe("txoracle_api_string");
    expect(parseActivationToken("{}" )).toBe("");
    expect(parseActivationToken("<html>gateway error</html>")).toBe("");
    expect(parseActivationToken("unexpected-success-body")).toBe("");
  });
});

describe("SseFrameParser", () => {
  it("parses a single data frame on blank line", () => {
    const p = new SseFrameParser();
    const frames = p.push('data: {"a":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('{"a":1}');
    expect(frames[0]!.heartbeat).toBe(false);
  });

  it("captures id and multi-line data", () => {
    const p = new SseFrameParser();
    const frames = p.push("id: 42\ndata: line1\ndata: line2\n\n");
    expect(frames[0]!.id).toBe("42");
    expect(frames[0]!.data).toBe("line1\nline2");
  });

  it("surfaces heartbeat comment frames instead of dropping them", () => {
    const p = new SseFrameParser();
    const frames = p.push(": keepalive\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.heartbeat).toBe(true);
  });

  it("handles chunk boundaries mid-frame", () => {
    const p = new SseFrameParser();
    expect(p.push("data: hel")).toHaveLength(0);
    const frames = p.push("lo\n\n");
    expect(frames[0]!.data).toBe("hello");
  });
});

describe("captured SSE response parsing", () => {
  it("parses JSON data records while ignoring ids and comments", () => {
    expect(parseJsonSse(': heartbeat\nid: 1\ndata: {"FixtureId":7}\n\nid: 2\ndata: {"FixtureId":8,\ndata: "ok":true}\n\n'))
      .toEqual([{ FixtureId: 7 }, { FixtureId: 8, ok: true }]);
  });
});

describe("FeedHealthTracker", () => {
  it("dedupes by message id", () => {
    const h = new FeedHealthTracker("devnet", 8000, 4000);
    expect(h.accept("m1")).toBe(true);
    expect(h.accept("m1")).toBe(false);
    expect(h.accept("m2")).toBe(true);
  });

  it("detects soft-stale and hard gap from injected clock", () => {
    const h = new FeedHealthTracker("devnet", 8000, 4000);
    h.mark(1000);
    expect(h.verdict(2000).gapHalt).toBe(false);
    expect(h.verdict(6000).stale).toBe(true);
    expect(h.verdict(6000).gapHalt).toBe(false);
    expect(h.verdict(10000).gapHalt).toBe(true);
  });

  it("BUG-CLASS GUARD: verdict must be read BEFORE mark, or the gap is erased (V4)", () => {
    // Correct order: check gap since last activity, THEN record new activity.
    const good = new FeedHealthTracker("devnet", 8000, 4000);
    good.mark(1000);
    const gapSeen = good.verdict(20000).gapHalt; // 19s gap → halt
    good.mark(20000);
    expect(gapSeen).toBe(true);

    // Buggy order (mark-before-verdict at same ts): the gap is erased before it's seen.
    const bad = new FeedHealthTracker("devnet", 8000, 4000);
    bad.mark(1000);
    bad.mark(20000); // marking first...
    expect(bad.verdict(20000).gapHalt).toBe(false); // ...hides the 19s gap. Never do this.
  });
});

describe("normalizeScores", () => {
  it("reads cumulative goals/reds under the TOTAL period prefix", () => {
    const raw = {
      FixtureId: 111,
      Ts: 1720000000000,
      StatusId: STATUS.H2,
      Seq: 5,
      Stats: {
        [PERIOD_PREFIX.TOTAL + STAT_KEY.P1_GOALS]: 2,
        [PERIOD_PREFIX.TOTAL + STAT_KEY.P2_GOALS]: 1,
        [PERIOD_PREFIX.TOTAL + STAT_KEY.P2_RED]: 1,
      },
    };
    const m = normalizeScores(raw, "devnet");
    expect(m).not.toBeNull();
    expect(m!.homeScore).toBe(2);
    expect(m!.awayScore).toBe(1);
    expect(m!.awayReds).toBe(1);
    expect(m!.sourceSeq).toBe(5);
    expect(m!.isFinal).toBe(false);
  });

  it("marks finalised status as final and reads free_kick danger as pressure", () => {
    const fin = normalizeScores({ FixtureId: 1, StatusId: STATUS.FINALISED, Stats: {} }, "devnet");
    expect(fin!.isFinal).toBe(true);

    const fk = normalizeScores(
      { FixtureId: 1, StatusId: STATUS.H1, action: "free_kick", Data: { FreeKickType: "HighDanger", Participant: 1 }, Stats: {} },
      "devnet",
    );
    expect(fk!.possession.home).toBe("high_danger");
    expect(fk!.possession.away).toBe("none");
  });

  it("uses the real feed clock, top-level participant, and delivery sequence identity", () => {
    const first = normalizeScores({
      FixtureId: 7, Id: 97, Seq: 96, Ts: 1_000, StatusId: STATUS.H1,
      Action: "free_kick", Participant: 2, Clock: { Seconds: 406 },
      Data: { FreeKickType: "HighDanger" }, Stats: {},
    }, "mainnet");
    const amended = normalizeScores({
      FixtureId: 7, Id: 97, Seq: 99, Ts: 2_000, StatusId: STATUS.H1,
      Action: "free_kick", Participant: 2, Clock: { Seconds: 410 },
      Data: { FreeKickType: "Safe" }, Stats: {},
    }, "mainnet");
    expect(first!.minute).toBe(6);
    expect(first!.possession.away).toBe("high_danger");
    expect(first!.msgId).toBe("7:s:96");
    expect(amended!.msgId).toBe("7:s:99");
  });
});

describe("normalizeOdds", () => {
  it("classifies 1X2 and de-vigs implied probabilities to sum ~10000 bps", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "1X2", price_names: ["1", "X", "2"], prices: [2000, 3500, 4500], in_running: true },
      "devnet",
    );
    expect(m).not.toBeNull();
    if (m!.kind !== "odds") throw new Error("expected odds");
    const sum = Object.values(m!.consensus).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 10000)).toBeLessThanOrEqual(2);
    expect(m!.marketKey.market).toBe("1X2");
  });

  it("recognizes TxLINE's captured part1/draw/part2 selection names", () => {
    const m = normalizeOdds(
      { FixtureId: 18213979, SuperOddsType: "1X2_PARTICIPANT_RESULT", PriceNames: ["part1", "draw", "part2"], Prices: [4280, 4097, 1915] },
      "mainnet",
    );
    expect(m).not.toBeNull();
    expect(Object.keys(m!.consensus).sort()).toEqual(["AWAY", "DRAW", "HOME"]);
  });

  it("classifies totals with a line and canonicalizes Over/Under", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "Total Goals O/U", market_parameters: "2.5", price_names: ["Over", "Under"], prices: [1900, 2000] },
      "devnet",
    );
    if (!m || m.kind !== "odds") throw new Error("expected odds");
    expect(m.marketKey.market).toBe("TOTALS");
    expect(m.marketKey.lineTimes10).toBe(25);
    expect(Object.keys(m.consensus).sort()).toEqual(["OVER", "UNDER"]);
  });

  it("returns null for a market we don't quote", () => {
    expect(
      normalizeOdds({ fixture_id: 1, super_odds_type: "Asian Handicap", price_names: ["a"], prices: [1900] }, "devnet"),
    ).toBeNull();
  });
});

describe("normalizeScores — malformed and adversarial raw payloads", () => {
  it("rejects a message whose timestamp is not numeric (string, non-numeric)", () => {
    expect(normalizeScores({ FixtureId: 1, Ts: "not-a-number", StatusId: 2, Stats: {} }, "devnet")).toBeNull();
  });

  it("rejects a message whose timestamp is non-finite (Infinity, NaN)", () => {
    expect(normalizeScores({ FixtureId: 1, Ts: Infinity, StatusId: 2, Stats: {} }, "devnet")).toBeNull();
    expect(normalizeScores({ FixtureId: 1, Ts: NaN, StatusId: 2, Stats: {} }, "devnet")).toBeNull();
  });

  it("a real numeric-string timestamp (JSON numbers arrive as JS numbers, but be defensive) is still accepted", () => {
    const m = normalizeScores({ FixtureId: 1, Ts: 1720000000000, StatusId: 2, Stats: {} }, "devnet");
    expect(m).not.toBeNull();
    expect(typeof m!.ts).toBe("number");
  });

  it("clamps a negative cumulative stat (corrupted feed value) to zero instead of producing an impossible score", () => {
    const m = normalizeScores(
      { FixtureId: 1, Ts: 1000, StatusId: 2, Stats: { [PERIOD_PREFIX.TOTAL + STAT_KEY.P1_GOALS]: -99 } },
      "devnet",
    );
    expect(m!.homeScore).toBe(0);
  });

  it("a non-numeric stat field coerces safely to zero rather than propagating NaN into match state", () => {
    const m = normalizeScores(
      { FixtureId: 1, Ts: 1000, StatusId: 2, Stats: { [PERIOD_PREFIX.TOTAL + STAT_KEY.P1_GOALS]: "banana" } },
      "devnet",
    );
    expect(m!.homeScore).toBe(0);
    expect(Number.isFinite(m!.homeScore)).toBe(true);
  });

  it("a null or missing Stats object does not crash normalization", () => {
    expect(normalizeScores({ FixtureId: 1, Ts: 1000, StatusId: 2, Stats: null }, "devnet")).not.toBeNull();
    expect(normalizeScores({ FixtureId: 1, Ts: 1000, StatusId: 2 }, "devnet")).not.toBeNull();
  });

  it("an empty fixtureId rejects the message rather than defaulting to a fabricated identity", () => {
    expect(normalizeScores({ FixtureId: "", Ts: 1000, StatusId: 2, Stats: {} }, "devnet")).toBeNull();
    expect(normalizeScores({ Ts: 1000, StatusId: 2, Stats: {} }, "devnet")).toBeNull();
  });
});

describe("normalizeOdds — malformed and adversarial raw payloads", () => {
  it("rejects a message whose timestamp is not numeric or non-finite", () => {
    expect(normalizeOdds({ fixture_id: 1, super_odds_type: "1X2", ts: "not-a-number", price_names: ["1", "X", "2"], prices: [2000, 3500, 4500] }, "devnet")).toBeNull();
    expect(normalizeOdds({ fixture_id: 1, super_odds_type: "1X2", ts: Infinity, price_names: ["1", "X", "2"], prices: [2000, 3500, 4500] }, "devnet")).toBeNull();
  });

  it("a single non-numeric price does not poison the whole market's consensus with NaN — the message is rejected outright", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "Total Goals O/U", market_parameters: "2.5", price_names: ["Over", "Under"], prices: ["banana", 1900] },
      "devnet",
    );
    expect(m).toBeNull();
  });

  it("a non-finite price (Infinity, NaN) is excluded from the selection set, not silently accepted", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "1X2", price_names: ["1", "X", "2"], prices: [Infinity, 3500, 4500] },
      "devnet",
    );
    // HOME's price was garbage and excluded; 1X2 requires HOME+AWAY present, so the whole
    // message is rejected rather than quoting a market with a missing leg.
    expect(m).toBeNull();
  });

  it("mismatched price_names/prices array lengths reject the message", () => {
    expect(
      normalizeOdds({ fixture_id: 1, super_odds_type: "1X2", price_names: ["1", "X", "2"], prices: [2000, 3500] }, "devnet"),
    ).toBeNull();
  });

  it("an empty fixtureId rejects the message", () => {
    expect(
      normalizeOdds({ super_odds_type: "1X2", price_names: ["1", "X", "2"], prices: [2000, 3500, 4500] }, "devnet"),
    ).toBeNull();
  });

  it("negative or zero prices are excluded from the selection set rather than producing a division-by-zero or negative implied probability", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "Total Goals O/U", market_parameters: "2.5", price_names: ["Over", "Under"], prices: [-100, 0] },
      "devnet",
    );
    expect(m).toBeNull();
  });

  it("every produced consensus value is a finite, real probability — never NaN or Infinity", () => {
    const m = normalizeOdds(
      { fixture_id: 1, super_odds_type: "1X2", price_names: ["1", "X", "2"], prices: [2000, 3500, 4500] },
      "devnet",
    );
    expect(m).not.toBeNull();
    if (!m || m.kind !== "odds") throw new Error("expected odds");
    for (const v of Object.values(m.consensus)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("synthetic corpus", () => {
  it("is deterministic (byte-identical across generations)", () => {
    const a = JSON.stringify(generateSyntheticCorpus());
    const b = JSON.stringify(generateSyntheticCorpus());
    expect(a).toBe(b);
  });

  it("contains ordered score+odds messages ending at FT 1-1", () => {
    const c = generateSyntheticCorpus();
    const scores = c.filter((m) => m.kind === "score");
    const last = scores[scores.length - 1]!;
    if (last.kind !== "score") throw new Error("expected score");
    expect(last.isFinal).toBe(true);
    expect(last.homeScore).toBe(1);
    expect(last.awayScore).toBe(1);
    expect(last.awayReds).toBe(1);
  });
});
