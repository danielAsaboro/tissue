import { describe, expect, it } from "vitest";
import { millis, type ScoreMessage } from "@tissue/shared";
import { loadPolicy } from "../config/policy.js";
import { STATUS } from "../ingest/soccerFeed.js";
import { MatchState } from "./matchState.js";

const policy = loadPolicy();

function score(o: Partial<ScoreMessage>): ScoreMessage {
  return {
    kind: "score",
    msgId: "m1",
    fixtureId: "F1",
    ts: millis(0),
    network: "devnet",
    minute: 0,
    homeScore: 0,
    awayScore: 0,
    homeReds: 0,
    awayReds: 0,
    possession: { home: "none", away: "none" },
    isFinal: false,
    isVoid: false,
    ...o,
  };
}

describe("MatchState phase/stoppage derivation", () => {
  it("regular time before minute 90 is regulation, not stoppage", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 60, phase: String(STATUS.H2) }));
    const ts = st.tissueState();
    expect(ts.matchPhase).toBe("regulation");
    expect(ts.stoppageActive).toBe(false);
  });

  it("H2 past minute 90 is regulation stoppage", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 92, phase: String(STATUS.H2) }));
    const ts = st.tissueState();
    expect(ts.matchPhase).toBe("regulation");
    expect(ts.stoppageActive).toBe(true);
  });

  it("ET1/ET2 report matchPhase extraTime", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 100, phase: String(STATUS.ET1) }));
    expect(st.tissueState().matchPhase).toBe("extraTime");
  });

  it("ET2 past minute 120 is extra-time stoppage", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 122, phase: String(STATUS.ET2) }));
    const ts = st.tissueState();
    expect(ts.matchPhase).toBe("extraTime");
    expect(ts.stoppageActive).toBe(true);
  });

  it("WPE/PE report matchPhase penalties, never stoppage", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 120, phase: String(STATUS.PE) }));
    const ts = st.tissueState();
    expect(ts.matchPhase).toBe("penalties");
    expect(ts.stoppageActive).toBe(false);
  });
});

describe("MatchState mutual-danger latch", () => {
  it("does not activate on a single side's pressure, however high", () => {
    const st = new MatchState(policy);
    st.applyScore(score({ minute: 60, phase: String(STATUS.H2), possession: { home: "high_danger", away: "none" } }));
    expect(st.tissueState(0).mutualDangerActive).toBe(false);
  });

  it("does not activate immediately even when both sides are simultaneously high-pressure", () => {
    const st = new MatchState(policy);
    st.applyScore(score({
      minute: 60, phase: String(STATUS.H2), ts: millis(0),
      possession: { home: "high_danger", away: "high_danger" },
    }));
    // Below policy.model.mutual_danger.min_duration_ms (45000ms) since it just started.
    expect(st.tissueState(1000).mutualDangerActive).toBe(false);
  });

  it("activates once both sides sustain high pressure simultaneously for min_duration_ms", () => {
    const st = new MatchState(policy);
    const dur = policy.model.mutual_danger.min_duration_ms;
    // A "sustained" dangerous spell is naturally reinforced by repeated events on both sides
    // (multiple shots/dangerous free-kicks), not one blip left to decay — reinforce every 5s.
    const stepMs = 5_000;
    for (let t = 0; t < dur; t += stepMs) {
      st.applyScore(score({
        minute: 60, phase: String(STATUS.H2), ts: millis(t),
        possession: { home: "high_danger", away: "high_danger" },
      }));
      if (t < dur - stepMs) expect(st.tissueState(t).mutualDangerActive).toBe(false);
    }
    expect(st.tissueState(dur + 1).mutualDangerActive).toBe(true);
  });

  it("is not permanently latched — decay eventually drops pressure back below threshold", () => {
    const st = new MatchState(policy);
    st.applyScore(score({
      minute: 60, phase: String(STATUS.H2), ts: millis(0),
      possession: { home: "high_danger", away: "high_danger" },
    }));
    const dur = policy.model.mutual_danger.min_duration_ms;
    const longAfter = dur * 10;
    expect(st.tissueState(longAfter).mutualDangerActive).toBe(false);
  });
});
