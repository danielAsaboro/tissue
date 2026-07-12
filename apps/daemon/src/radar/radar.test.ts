import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { percentile, percentileOf, computeBand } from "./percentiles.js";
import { runRadar, Radar } from "./index.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("percentiles", () => {
  it("nearest-rank percentile", () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 0)).toBe(10);
    expect(percentile(s, 50)).toBe(30);
    expect(percentile(s, 100)).toBe(50);
  });
  it("percentileOf counts share ≤ value", () => {
    expect(percentileOf([1, 2, 3, 4], 2)).toBe(50);
  });
  it("computeBand falls back to seed under minSamples", () => {
    const seed = { fastMs: 1500, slowMs: 9000 };
    expect(computeBand([1, 2], 20, 80, seed)).toEqual(seed);
  });
});

describe("Radar on the synthetic corpus", () => {
  it("detects the goal, red, and equalizer reactions and fires an unexplained HALT", () => {
    const corpus = generateSyntheticCorpus();
    const { events, halts } = runRadar(corpus, policy);

    // At least the three event-driven reactions + the unexplained move.
    expect(events.length).toBeGreaterThanOrEqual(4);

    // Unexplained-movement HALT fired (the 30:12 move with no preceding event).
    const unexplained = halts.filter((h) => h.reason === "unexplained-movement");
    expect(unexplained.length).toBeGreaterThanOrEqual(1);

    // Reaction events attribute to goals/reds.
    const goalReactions = events.filter((e) => e.triggerEvent.kind === "goal");
    const redReactions = events.filter((e) => e.triggerEvent.kind === "red_card");
    expect(goalReactions.length).toBeGreaterThanOrEqual(1);
    expect(redReactions.length).toBeGreaterThanOrEqual(1);

    // Every event carries one of the taxonomy classes.
    for (const e of events) {
      expect(typeof e.signalClass).toBe("string");
      expect(e.magnitudeBps).toBeGreaterThanOrEqual(0);
    }
  });

  it("classifies an overreaction when the market spikes then retraces", () => {
    const corpus = generateSyntheticCorpus();
    const { events } = runRadar(corpus, policy);
    const classes = new Set(events.map((e) => e.signalClass));
    // The 78'→82'→84' equalizer-spike-then-retrace should surface as overreaction.
    expect(classes.has("overreaction")).toBe(true);
  });

  it("is deterministic across two runs (identical events + halts)", () => {
    const corpus = generateSyntheticCorpus();
    const a = runRadar(corpus, policy);
    const b = runRadar(corpus, policy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("measures reaction latency for event-driven reactions", () => {
    const corpus = generateSyntheticCorpus();
    const { events } = runRadar(corpus, policy);
    const withLatency = events.filter((e) => e.reactionLatencyMs !== undefined);
    expect(withLatency.length).toBeGreaterThanOrEqual(1);
    for (const e of withLatency) expect(e.reactionLatencyMs!).toBeGreaterThanOrEqual(0);
  });
});
