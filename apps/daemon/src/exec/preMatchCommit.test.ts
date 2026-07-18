import { describe, expect, it } from "vitest";
import { bps, milliOdds, type TissueMarketPrice } from "@tissue/shared";
import { preparePreMatchCommitment } from "./preMatchCommit.js";

function markets(): TissueMarketPrice[] {
  return [
    {
      marketKey: { market: "1X2" },
      fairProb: { HOME: bps(5000), DRAW: bps(2800), AWAY: bps(2200) },
      fairOdds: { HOME: milliOdds(2000), DRAW: milliOdds(3571), AWAY: milliOdds(4545) },
    },
  ];
}

describe("preparePreMatchCommitment — deterministic, offline, no network", () => {
  it("produces a stable hash for the same inputs", () => {
    const a = preparePreMatchCommitment("F1", 1000, markets());
    const b = preparePreMatchCommitment("F1", 1000, markets());
    expect(a.hash).toBe(b.hash);
  });

  it("produces a different hash when the fixtureId, ts, or markets differ", () => {
    const base = preparePreMatchCommitment("F1", 1000, markets());
    expect(preparePreMatchCommitment("F2", 1000, markets()).hash).not.toBe(base.hash);
    expect(preparePreMatchCommitment("F1", 2000, markets()).hash).not.toBe(base.hash);
    const changed = markets();
    changed[0] = { ...changed[0]!, fairProb: { ...changed[0]!.fairProb, HOME: bps(5001) } };
    expect(preparePreMatchCommitment("F1", 1000, changed).hash).not.toBe(base.hash);
  });

  it("carries the fixtureId, ts, and markets through verbatim", () => {
    const m = markets();
    const c = preparePreMatchCommitment("F1", 1000, m);
    expect(c.fixtureId).toBe("F1");
    expect(c.ts).toBe(1000);
    expect(c.markets).toEqual(m);
  });

  it("hash is a 64-char hex sha256", () => {
    const c = preparePreMatchCommitment("F1", 1000, markets());
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
