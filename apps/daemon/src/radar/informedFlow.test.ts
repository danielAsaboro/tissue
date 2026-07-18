import { describe, expect, it } from "vitest";
import { isInformedFlowVelocity, moveVelocityBpsPerSec, type InformedFlowConfig } from "./informedFlow.js";

const CFG: InformedFlowConfig = { toxicPercentile: 90, minSamples: 8, seedVelocityBpsPerSec: 40 };

describe("moveVelocityBpsPerSec", () => {
  it("computes bps moved per second", () => {
    expect(moveVelocityBpsPerSec(100, 2000)).toBeCloseTo(50, 6); // 100bps over 2s = 50bps/s
  });
  it("returns 0 for a non-positive time delta (never divides by zero or goes negative)", () => {
    expect(moveVelocityBpsPerSec(100, 0)).toBe(0);
    expect(moveVelocityBpsPerSec(100, -500)).toBe(0);
  });
});

describe("isInformedFlowVelocity — self-calibrating per-market threshold", () => {
  it("uses the seed threshold before enough trailing samples exist", () => {
    const fewSamples = [10, 12, 11]; // below minSamples=8
    expect(isInformedFlowVelocity(30, fewSamples, CFG)).toBe(false); // below seed 40
    expect(isInformedFlowVelocity(50, fewSamples, CFG)).toBe(true); // above seed 40
  });

  it("uses the empirical trailing percentile once enough samples exist, not the seed", () => {
    // 10 calm samples clustered around 5 bps/sec — the 90th percentile is well below the
    // seed of 40, so a market that's normally very quiet should trip much earlier.
    const calmSamples = [4, 5, 5, 6, 5, 4, 6, 5, 5, 6];
    expect(isInformedFlowVelocity(15, calmSamples, CFG)).toBe(true);
  });

  it("does not flag a velocity that's normal for a naturally volatile market", () => {
    // A market that's always jumpy (e.g. right after kickoff): the same absolute velocity
    // that would be anomalous on a calm market is normal here.
    const volatileSamples = [30, 45, 38, 50, 42, 35, 48, 40, 44, 39];
    expect(isInformedFlowVelocity(45, volatileSamples, CFG)).toBe(false);
  });
});
