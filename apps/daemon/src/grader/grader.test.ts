import { describe, expect, it } from "vitest";
import type { TimelineSample } from "@tissue/shared";
import { loadPolicy } from "../config/policy.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { runEngine } from "../replay/engine.js";
import { buildBacktestTimeline, computeStreaks } from "./grader.js";

function sample(win: boolean): TimelineSample {
  return {
    seq: 0,
    msgId: "m",
    ts: 0,
    marketKey: "1X2",
    selection: "HOME",
    side: "BACK",
    quoteMilliOdds: 2000,
    closingMilliOdds: 2000,
    clvBps: win ? 100 : -100,
    win,
    matched: false,
  };
}

describe("computeStreaks — pure streak analysis over an ordered win/loss sequence", () => {
  it("tracks the longest streak of each kind independently of which one is current", () => {
    // #given a sequence with a longer loss run than win run, ending on a win
    const samples = [true, true, false, false, false, true].map(sample);

    // #when
    const streaks = computeStreaks(samples);

    // #then
    expect(streaks.longestWinStreak).toBe(2);
    expect(streaks.longestLossStreak).toBe(3);
    expect(streaks.currentStreak).toEqual({ kind: "win", length: 1 });
  });

  it("reports no streak for an empty sequence", () => {
    expect(computeStreaks([])).toEqual({
      longestWinStreak: 0,
      longestLossStreak: 0,
      currentStreak: { kind: "none", length: 0 },
    });
  });

  it("a single sample is a streak of length one of its own kind", () => {
    expect(computeStreaks([sample(false)]).currentStreak).toEqual({ kind: "loss", length: 1 });
  });
});

describe("buildBacktestTimeline — decision-by-decision replay against a real corpus", () => {
  it("produces one cumulative win-rate point per sample, monotonically tracking wins/total", () => {
    const policy = loadPolicy();
    const result = runEngine(generateSyntheticCorpus("TIMELINE-1"), policy);

    const timeline = buildBacktestTimeline(result);

    expect(timeline.samples).toHaveLength(timeline.cumulativeWinRate.length);
    let wins = 0;
    timeline.samples.forEach((s, i) => {
      if (s.win) wins += 1;
      expect(timeline.cumulativeWinRate[i]).toBeCloseTo(wins / (i + 1));
    });
    expect(timeline.strikeRate).toBe(timeline.samples.length === 0 ? 0 : wins / timeline.samples.length);
  });

  it("agrees with computeStreaks run directly over its own samples", () => {
    const policy = loadPolicy();
    const result = runEngine(generateSyntheticCorpus("TIMELINE-2"), policy);

    const timeline = buildBacktestTimeline(result);

    expect(timeline.streaks).toEqual(computeStreaks(timeline.samples));
  });
});
