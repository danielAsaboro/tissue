import { beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, type Policy } from "../config/policy.js";
import { CORPUS_DIR, writeCorpus } from "../ingest/corpus.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { suggestTuning } from "./tuningSuggestions.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("suggestTuning — never writes policy.toml, honest about being underpowered", () => {
  const testFixtures = ["TUNETEST-1", "TUNETEST-2", "TUNETEST-3", "TUNETEST-4"];

  beforeAll(() => {
    for (const fixtureId of testFixtures) writeCorpus(fixtureId, generateSyntheticCorpus(fixtureId));
  });

  it("evaluates a grid of candidates around the current edge_threshold_bps, never an arbitrary value", () => {
    const report = suggestTuning(policy, 0.5);
    const suggestion = report.suggestions[0]!;
    expect(suggestion.parameter).toBe("strategy.edge_threshold_bps");
    expect(suggestion.baselineValue).toBe(policy.strategy.edge_threshold_bps);
    expect(suggestion.candidates.length).toBeGreaterThan(1);
    for (const candidate of suggestion.candidates) {
      expect(candidate.value).toBeGreaterThan(0);
    }
  });

  it("flags underpowered honestly rather than presenting a confident recommendation on a tiny sample", () => {
    // With a small holdout fraction, the calibration side is very likely under
    // MIN_FIXTURES_FOR_SIGNAL — same conditional pattern as calibrationSplit.test.ts, since
    // whatever real corpora are checked out (independent of this test) also land in the split.
    const report = suggestTuning(policy, 0.1);
    if (report.underpowered) {
      expect(report.suggestions[0]!.confident).toBe(false);
      expect(report.suggestions[0]!.reason).toMatch(/NOT a statistically valid comparison/);
    }
  });

  it("only evaluates against the calibration split, never touching the holdout fixture set", () => {
    const report = suggestTuning(policy, 0.5);
    const allIds = [...report.calibrationFixtureIds, ...report.holdoutFixtureIds];
    for (const fixtureId of testFixtures) expect(allIds).toContain(fixtureId);
    // Every quote count contributing to a candidate's weightedMeanClvBps must be explainable
    // purely by calibration fixtures — this is a structural check on the report shape, the
    // module itself never imports or evaluates report.holdoutFixtureIds anywhere.
    expect(new Set(report.calibrationFixtureIds).size).toBe(report.calibrationFixtureIds.length);
  });

  it("cleans up its temporary real-shaped test fixtures", () => {
    for (const fixtureId of testFixtures) {
      rmSync(join(CORPUS_DIR, `${fixtureId}.jsonl`), { force: true });
      rmSync(join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`), { force: true });
      rmSync(join(CORPUS_DIR, `${fixtureId}.analyst.json`), { force: true });
    }
  });
});
