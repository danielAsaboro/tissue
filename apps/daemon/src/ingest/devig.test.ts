import { describe, expect, it } from "vitest";
import { normalizeOdds } from "./normalize.js";
import type { OddsMessage } from "@tissue/shared";

/**
 * V1 — pins that de-vig is applied AT MOST ONCE and is idempotent on an already-de-margined
 * StablePrice input (D-005 / GROUND-TRUTH T2). The stream is TxODDS StablePrice: fully
 * de-margined consensus ("effectively probabilities"). normalizeOdds re-normalizes to sum=1,
 * but re-normalizing a unit-sum vector is the IDENTITY — it removes (overround − 1) of margin,
 * which is ~0 for a de-margined price. This test disproves compounding.
 *
 * No live capture exists yet (wallet not activated — see V2), so the fixture is a realistic
 * StablePrice-shaped value: decimal odds ×1000 whose implied probs already sum to ~1.0.
 */

function oddsRecord(prices: number[], names = ["1", "X", "2"]): Record<string, unknown> {
  return { fixture_id: 18209181, super_odds_type: "1X2", price_names: names, prices, in_running: true };
}

function asOdds(m: OddsMessage | null): OddsMessage {
  if (!m || m.kind !== "odds") throw new Error("expected odds");
  return m;
}

describe("V1 — odds de-vig is single-pass and idempotent on de-margined input", () => {
  // Realistic StablePrice de-margined 1X2: p ≈ [0.5501, 0.2500, 0.2000], sum ≈ 1.0001.
  const DE_MARGINED = [1818, 4000, 5000];

  it("preserves an already-de-margined price (removes ~0 additional margin)", () => {
    const m = asOdds(normalizeOdds(oddsRecord(DE_MARGINED), "devnet"));
    const rawImplied = DE_MARGINED.map((p) => Math.round((1000 / p / DE_MARGINED.reduce((s, x) => s + 1000 / x, 0)) * 10000));
    // consensus equals the raw implied (scaled to 10000) within rounding — no shift, no
    // second margin removal.
    expect(Math.abs(m.consensus["HOME"]! - rawImplied[0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.consensus["DRAW"]! - rawImplied[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.consensus["AWAY"]! - rawImplied[2]!)).toBeLessThanOrEqual(1);
    expect(m.consensus["HOME"]! + m.consensus["DRAW"]! + m.consensus["AWAY"]!).toBe(10000);
  });

  it("is idempotent: feeding the normalized output back as a price set does not de-vig again", () => {
    const first = asOdds(normalizeOdds(oddsRecord(DE_MARGINED), "devnet"));
    // Reconstruct decimal odds ×1000 from the consensus probs (as if the stream re-sent them).
    const reconstructedPrices = ["HOME", "DRAW", "AWAY"].map((k) => Math.round((10000 / first.consensus[k]!) * 1000));
    const second = asOdds(normalizeOdds(oddsRecord(reconstructedPrices), "devnet"));
    // Second pass must reproduce the first (within 1 bps rounding) — no compounding.
    for (const k of ["HOME", "DRAW", "AWAY"]) {
      expect(Math.abs(second.consensus[k]! - first.consensus[k]!)).toBeLessThanOrEqual(1);
    }
  });

  it("REAL CAPTURE: our de-vig reproduces TxLINE's official StablePrice Pct (FRA 2-0 MAR)", () => {
    // Captured live from txline-dev on 2026-07-09 (fixture 18209181, full-match O/U 2.5):
    //   Bookmaker "TXLineStablePriceDemargined", Prices [1739, 2354], Pct ["57.504","42.481"].
    // The Bookmaker name and the ~100%-summing Pct both confirm D-005 (de-margined consensus).
    const m = asOdds(normalizeOdds(
      { fixture_id: 18209181, super_odds_type: "OVERUNDER_PARTICIPANT_GOALS", market_parameters: "line=2.5", price_names: ["over", "under"], prices: [1739, 2354], in_running: true },
      "devnet",
    ));
    // Our de-vig lands within 2 bps of the official de-margined Pct — no double removal.
    expect(Math.abs(m.consensus["OVER"]! - 5750)).toBeLessThanOrEqual(2); // official 57.504%
    expect(Math.abs(m.consensus["UNDER"]! - 4248)).toBeLessThanOrEqual(2); // official 42.481%
  });

  it("removes margin exactly once on a margined book (overround > 1)", () => {
    // Margined: p ≈ [0.526, 0.294, 0.250], overround ≈ 1.070 (7% vig).
    const margined = [1900, 3400, 4000];
    const impliedSum = margined.reduce((s, p) => s + 1000 / p, 0);
    expect(impliedSum).toBeGreaterThan(1.05); // there IS margin to remove
    const m = asOdds(normalizeOdds(oddsRecord(margined), "devnet"));
    // Output sums to ~1.0 (10000 bps ±rounding): margin removed once, not twice.
    expect(Math.abs(m.consensus["HOME"]! + m.consensus["DRAW"]! + m.consensus["AWAY"]! - 10000)).toBeLessThanOrEqual(2);
    // Each de-vigged prob < its raw implied (margin was removed, in the right direction).
    expect(m.consensus["HOME"]! / 10000).toBeLessThan(1000 / margined[0]!);
    // Relative ordering/ratios preserved (de-vig only rescales).
    expect(m.consensus["HOME"]!).toBeGreaterThan(m.consensus["DRAW"]!);
  });
});
