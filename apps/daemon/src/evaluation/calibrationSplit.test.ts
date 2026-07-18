import { beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, type Policy } from "../config/policy.js";
import { CORPUS_DIR, writeCorpus } from "../ingest/corpus.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { runCalibrationSplit, splitFixtures } from "./calibrationSplit.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("splitFixtures — deterministic, sha256-bucketed, never insertion order", () => {
  it("partitions every input into exactly one side", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `FIXTURE-${i}`);
    const { calibration, holdout } = splitFixtures(ids, 0.3);
    expect(new Set([...calibration, ...holdout]).size).toBe(ids.length);
    expect(calibration.length + holdout.length).toBe(ids.length);
  });

  it("is deterministic — same input, same split, every run", () => {
    const ids = ["18209181", "17588302", "18218149", "18213979"];
    const a = splitFixtures(ids, 0.3);
    const b = splitFixtures(ids, 0.3);
    expect(a).toEqual(b);
  });

  it("is independent of input order", () => {
    const ids = ["18209181", "17588302", "18218149", "18213979"];
    const forward = splitFixtures(ids, 0.3);
    const reversed = splitFixtures([...ids].reverse(), 0.3);
    expect(new Set(forward.calibration)).toEqual(new Set(reversed.calibration));
    expect(new Set(forward.holdout)).toEqual(new Set(reversed.holdout));
  });

  it("roughly matches the requested holdout fraction over a large sample", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `F-${i}`);
    const { calibration, holdout } = splitFixtures(ids, 0.3);
    const holdoutRatio = holdout.length / ids.length;
    expect(holdoutRatio).toBeGreaterThan(0.2);
    expect(holdoutRatio).toBeLessThan(0.4);
    expect(calibration.length).toBeGreaterThan(0);
  });

  it("rejects an out-of-range holdout fraction", () => {
    expect(() => splitFixtures(["a"], 0)).toThrow();
    expect(() => splitFixtures(["a"], 1)).toThrow();
    expect(() => splitFixtures(["a"], 1.5)).toThrow();
  });
});

describe("runCalibrationSplit — real-corpora-only, honest about being underpowered", () => {
  const testFixtures = ["CALTEST-1", "CALTEST-2", "CALTEST-3", "CALTEST-4"];

  beforeAll(() => {
    for (const fixtureId of testFixtures) writeCorpus(fixtureId, generateSyntheticCorpus(fixtureId));
  });

  it("aggregates each side from real evaluateCorpus rows, not fabricated numbers", () => {
    const report = runCalibrationSplit(policy, 0.5);
    const allIds = [...report.calibration.fixtureIds, ...report.holdout.fixtureIds];
    for (const fixtureId of testFixtures) expect(allIds).toContain(fixtureId);
    expect(report.calibration.fixtures + report.holdout.fixtures).toBe(allIds.length);
  });

  it("flags underpowered when either side has fewer than 3 fixtures", () => {
    // With only 4 real fixtures total and holdoutFraction=0.3, one side is very likely <3.
    const report = runCalibrationSplit(policy, 0.3);
    if (report.calibration.fixtures < 3 || report.holdout.fixtures < 3) {
      expect(report.underpowered).toBe(true);
    }
  });

  it("cleans up its temporary real-shaped test fixtures", () => {
    for (const fixtureId of testFixtures) {
      rmSync(join(CORPUS_DIR, `${fixtureId}.jsonl`), { force: true });
      rmSync(join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`), { force: true });
      rmSync(join(CORPUS_DIR, `${fixtureId}.analyst.json`), { force: true });
    }
  });
});
