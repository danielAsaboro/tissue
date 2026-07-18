import { describe, expect, it } from "vitest";
import {
  PHASE_START_MINUTE,
  STATUS,
  isExtraTimePhase,
  isPenaltiesPhase,
  isStoppageTime,
} from "./soccerFeed.js";

describe("soccerFeed phase helpers", () => {
  it("PHASE_START_MINUTE covers every extra-time/penalties status (no minute=0 fallback bug)", () => {
    expect(PHASE_START_MINUTE[STATUS.WET]).toBe(90);
    expect(PHASE_START_MINUTE[STATUS.ET1]).toBe(90);
    expect(PHASE_START_MINUTE[STATUS.HTET]).toBe(105);
    expect(PHASE_START_MINUTE[STATUS.ET2]).toBe(105);
    expect(PHASE_START_MINUTE[STATUS.WPE]).toBe(120);
    expect(PHASE_START_MINUTE[STATUS.PE]).toBe(120);
  });

  it("isExtraTimePhase covers WET/ET1/HTET/ET2 and nothing else", () => {
    for (const s of [STATUS.WET, STATUS.ET1, STATUS.HTET, STATUS.ET2]) {
      expect(isExtraTimePhase(s)).toBe(true);
    }
    for (const s of [STATUS.NS, STATUS.H1, STATUS.HT, STATUS.H2, STATUS.WPE, STATUS.PE]) {
      expect(isExtraTimePhase(s)).toBe(false);
    }
  });

  it("isPenaltiesPhase covers WPE/PE and nothing else", () => {
    expect(isPenaltiesPhase(STATUS.WPE)).toBe(true);
    expect(isPenaltiesPhase(STATUS.PE)).toBe(true);
    expect(isPenaltiesPhase(STATUS.ET2)).toBe(false);
    expect(isPenaltiesPhase(STATUS.H2)).toBe(false);
  });

  it("isStoppageTime fires only past the nominal boundary within the same live status", () => {
    expect(isStoppageTime(STATUS.H2, 89, 90, 120)).toBe(false);
    expect(isStoppageTime(STATUS.H2, 90, 90, 120)).toBe(true);
    expect(isStoppageTime(STATUS.H2, 93, 90, 120)).toBe(true);
    // Once the feed has transitioned to WET, it's no longer "H2 stoppage".
    expect(isStoppageTime(STATUS.WET, 91, 90, 120)).toBe(false);
    expect(isStoppageTime(STATUS.ET2, 119, 90, 120)).toBe(false);
    expect(isStoppageTime(STATUS.ET2, 120, 90, 120)).toBe(true);
    expect(isStoppageTime(STATUS.ET2, 123, 90, 120)).toBe(true);
  });
});
