import { describe, expect, it } from "vitest";
import { millis, milliOdds, units, type Intent } from "@tissue/shared";
import { restingQuoteAgeMs, staleQuoteSpreadMult, type StaleQuoteConfig } from "./staleQuote.js";

function intent(o: Partial<Intent>): Intent {
  return {
    id: "i1",
    fixtureId: "F",
    marketKey: { market: "1X2" },
    selection: "HOME",
    side: "BACK",
    priceMilliOdds: milliOdds(2000),
    sizeUnits: units(100),
    filledUnits: units(0),
    status: "Posted",
    simulated: true,
    createdMsgId: "m1",
    createdTs: millis(0),
    ...o,
  };
}

describe("restingQuoteAgeMs", () => {
  it("is 0 when there is no matching open intent", () => {
    expect(restingQuoteAgeMs([], { market: "1X2" }, "HOME", "BACK", 10_000)).toBe(0);
  });

  it("returns elapsed time since the intent's createdTs", () => {
    const open = [intent({ createdTs: millis(1_000) })];
    expect(restingQuoteAgeMs(open, { market: "1X2" }, "HOME", "BACK", 5_000)).toBe(4_000);
  });

  it("ignores intents on a different market, selection, or side", () => {
    const open = [
      intent({ marketKey: { market: "TOTALS", lineTimes10: 25 }, createdTs: millis(0) }),
      intent({ selection: "AWAY", createdTs: millis(0) }),
      intent({ side: "LAY", createdTs: millis(0) }),
    ];
    expect(restingQuoteAgeMs(open, { market: "1X2" }, "HOME", "BACK", 10_000)).toBe(0);
  });

  it("uses the MOST RECENTLY posted intent when several are open on the same selection+side", () => {
    const open = [intent({ id: "old", createdTs: millis(0) }), intent({ id: "new", createdTs: millis(8_000) })];
    expect(restingQuoteAgeMs(open, { market: "1X2" }, "HOME", "BACK", 10_000)).toBe(2_000);
  });
});

describe("staleQuoteSpreadMult", () => {
  const cfg: StaleQuoteConfig = { decayMs: 100_000, minSpreadMult: 0.7 };

  it("is 1.0 (no compression) at age 0", () => {
    expect(staleQuoteSpreadMult(0, cfg)).toBe(1);
  });

  it("linearly ramps down to the floor as age approaches decayMs", () => {
    expect(staleQuoteSpreadMult(50_000, cfg)).toBeCloseTo(0.85, 6); // halfway: 1 - 0.5*0.3
  });

  it("clamps at the floor beyond decayMs — does not compress without limit", () => {
    expect(staleQuoteSpreadMult(100_000, cfg)).toBeCloseTo(0.7, 6);
    expect(staleQuoteSpreadMult(1_000_000, cfg)).toBeCloseTo(0.7, 6);
  });
});
