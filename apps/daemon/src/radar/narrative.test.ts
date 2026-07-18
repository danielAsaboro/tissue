import { describe, expect, it } from "vitest";
import type { RadarClass, RadarEvent } from "@tissue/shared";
import { classifyNarrative, type NarrativeConfig } from "./narrative.js";

const CFG: NarrativeConfig = { windowMs: 100_000, dominanceFraction: 0.7, minSamples: 3 };

function event(ts: number, signalClass: RadarClass): RadarEvent {
  return {
    marketKey: { market: "1X2" },
    triggerEvent: { kind: "goal", msgId: `m${ts}`, ts, minute: 0 },
    eventTs: ts,
    magnitudeBps: 100,
    signalClass,
  } as RadarEvent;
}

describe("classifyNarrative — path-dependent market regime", () => {
  it("is neutral below minSamples, regardless of the pattern", () => {
    const events = [event(0, "stale-line"), event(10, "stale-line")];
    expect(classifyNarrative(events, 20, CFG)).toBe("neutral");
  });

  it("classifies compounding when stale-line/late-reaction dominate the window", () => {
    const events = [
      event(0, "stale-line"),
      event(10, "late-reaction"),
      event(20, "stale-line"),
      event(30, "late-reaction"),
    ];
    expect(classifyNarrative(events, 40, CFG)).toBe("compounding");
  });

  it("classifies cautious when overreaction/favorite-panic dominate the window", () => {
    const events = [
      event(0, "overreaction"),
      event(10, "favorite-panic"),
      event(20, "overreaction"),
      event(30, "favorite-panic"),
    ];
    expect(classifyNarrative(events, 40, CFG)).toBe("cautious");
  });

  it("classifies oscillating when the taxonomy alternates with no dominant side", () => {
    const events = [
      event(0, "stale-line"),
      event(10, "overreaction"),
      event(20, "late-reaction"),
      event(30, "favorite-panic"),
    ];
    expect(classifyNarrative(events, 40, CFG)).toBe("oscillating");
  });

  it("ignores events outside the trailing window", () => {
    const events = [
      event(0, "overreaction"), // outside the 100_000ms window when atTs=200_000
      event(150_000, "stale-line"),
      event(160_000, "late-reaction"),
      event(170_000, "stale-line"),
    ];
    expect(classifyNarrative(events, 200_000, CFG)).toBe("compounding");
  });

  it("ignores signal classes outside the compounding/cautious taxonomy (e.g. fast-reaction)", () => {
    const events = [
      event(0, "fast-reaction"),
      event(10, "fast-reaction"),
      event(20, "fast-reaction"),
      event(30, "unexplained-movement"),
    ];
    expect(classifyNarrative(events, 40, CFG)).toBe("neutral");
  });

  it("is deterministic — same input, same output", () => {
    const events = [event(0, "stale-line"), event(10, "late-reaction"), event(20, "stale-line")];
    expect(classifyNarrative(events, 30, CFG)).toBe(classifyNarrative(events, 30, CFG));
  });
});
