import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { poissonPmf, scoreMatrix, dcTau } from "./poisson.js";
import { outcome1x2, outcomeTotals } from "./outcomes.js";
import { solveBaseLambdas } from "./solve.js";
import { remainingTimeFraction } from "./inplay.js";
import type { TissueState } from "./price.js";
import { TissuePricer, solveConfigFromPolicy } from "./index.js";
import { readCorpus } from "../ingest/corpus.js";
import { generateSyntheticCorpus, SYNTHETIC_FIXTURE_ID } from "../ingest/synthetic.js";
import { writeCorpus } from "../ingest/corpus.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
  // ensure the corpus exists for the property test even on a clean checkout
  writeCorpus(SYNTHETIC_FIXTURE_ID, generateSyntheticCorpus());
});

const NEUTRAL = { homePressure: 0, awayPressure: 0 } as const;
function state(o: Partial<TissueState>): TissueState {
  return { minute: 0, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, ...NEUTRAL, ...o };
}

describe("poisson", () => {
  it("pmf sums to ~1 and p(0)=e^-lambda", () => {
    const p = poissonPmf(1.7, 25);
    expect(p[0]!).toBeCloseTo(Math.exp(-1.7), 10);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
  });

  it("dcTau matches the DC 1997 formulas on the four cells", () => {
    const lh = 1.3, la = 1.1, rho = -0.13;
    expect(dcTau(0, 0, lh, la, rho)).toBeCloseTo(1 - lh * la * rho, 12);
    expect(dcTau(0, 1, lh, la, rho)).toBeCloseTo(1 + lh * rho, 12);
    expect(dcTau(1, 0, lh, la, rho)).toBeCloseTo(1 + la * rho, 12);
    expect(dcTau(1, 1, lh, la, rho)).toBeCloseTo(1 - rho, 12);
    expect(dcTau(2, 3, lh, la, rho)).toBe(1);
  });

  it("scoreMatrix normalizes to 1 and is symmetric when lambdas are equal", () => {
    const m = scoreMatrix(1.4, 1.4, -0.1, 10);
    let total = 0;
    for (const row of m) for (const v of row) total += v;
    expect(total).toBeCloseTo(1, 9);
    expect(m[3]![1]!).toBeCloseTo(m[1]![3]!, 12);
  });
});

describe("outcomes monotonicity", () => {
  it("more home lambda ⇒ more home win prob", () => {
    const low = outcome1x2(scoreMatrix(1.0, 1.2, -0.1, 10), 0, 0);
    const high = outcome1x2(scoreMatrix(1.8, 1.2, -0.1, 10), 0, 0);
    expect(high.home).toBeGreaterThan(low.home);
  });
  it("1X2 sums to 1; totals over rises with mu", () => {
    const o = outcome1x2(scoreMatrix(1.5, 1.1, -0.1, 10), 0, 0);
    expect(o.home + o.draw + o.away).toBeCloseTo(1, 9);
    const lowMu = outcomeTotals(scoreMatrix(0.6, 0.6, -0.1, 10), 0, 0, 2.5).over;
    const highMu = outcomeTotals(scoreMatrix(1.6, 1.6, -0.1, 10), 0, 0, 2.5).over;
    expect(highMu).toBeGreaterThan(lowMu);
  });
});

describe("solve round-trip", () => {
  it("recovers the input 1X2+totals market at minute 0 (within tolerance)", () => {
    const cfg = solveConfigFromPolicy(policy);
    const inp = { home: 0.5, draw: 0.28, away: 0.22, totals: { line: 2.5, over: 0.52 } };
    const base = solveBaseLambdas(inp, cfg);
    const m = scoreMatrix(base.home, base.away, cfg.rho, cfg.maxGoals);
    const o = outcome1x2(m, 0, 0);
    const t = outcomeTotals(m, 0, 0, 2.5);
    // home + over are the two solved targets → tight; away is derived from (mu, share)
    // with a fixed rho, so a 2-parameter fit leaves a small residual on the 3rd 1X2 leg.
    expect(o.home).toBeCloseTo(0.5, 2);
    expect(t.over).toBeCloseTo(0.52, 2);
    expect(Math.abs(o.away - 0.22)).toBeLessThan(0.02);
  });

  it("solves from 1X2 alone via the draw prior", () => {
    const cfg = solveConfigFromPolicy(policy);
    const base = solveBaseLambdas({ home: 0.45, draw: 0.27, away: 0.28 }, cfg);
    expect(base.home).toBeGreaterThan(0);
    expect(base.away).toBeGreaterThan(0);
    const o = outcome1x2(scoreMatrix(base.home, base.away, cfg.rho, cfg.maxGoals), 0, 0);
    expect(o.home).toBeCloseTo(0.45, 2);
  });

  it("boots from a totals-only TxLINE bundle without inventing a 1X2 input", () => {
    const cfg = solveConfigFromPolicy(policy);
    const base = solveBaseLambdas({ totals: { line: 2.5, over: 0.52 } }, cfg);
    expect(base.home).toBeCloseTo(base.away, 10);
    const t = outcomeTotals(scoreMatrix(base.home, base.away, cfg.rho, cfg.maxGoals), 0, 0, 2.5);
    expect(t.over).toBeCloseTo(0.52, 2);
  });
});

describe("in-play adjustments", () => {
  it("remaining-time fraction is 1 at KO, 0 at/after FT", () => {
    expect(remainingTimeFraction(0, 90)).toBe(1);
    expect(remainingTimeFraction(45, 90)).toBeCloseTo(0.5, 9);
    expect(remainingTimeFraction(95, 90)).toBe(0);
  });

  it("a lead late in the match drives the leader's win prob toward certainty", () => {
    const pricer = new TissuePricer({ home: 0.5, draw: 0.28, away: 0.22, totals: { line: 2.5, over: 0.52 } }, policy);
    const early = pricer.price(state({ minute: 10, homeScore: 1, awayScore: 0 }));
    const late = pricer.price(state({ minute: 88, homeScore: 1, awayScore: 0 }));
    const homeEarly = early.markets[0]!.fairProb["HOME"]!;
    const homeLate = late.markets[0]!.fairProb["HOME"]!;
    expect(homeLate).toBeGreaterThan(homeEarly);
    expect(homeLate).toBeGreaterThan(9000); // >90% with a late lead
  });

  it("a red card to the away side raises home win prob", () => {
    const pricer = new TissuePricer({ home: 0.5, draw: 0.28, away: 0.22, totals: { line: 2.5, over: 0.52 } }, policy);
    const base = pricer.price(state({ minute: 60 }));
    const red = pricer.price(state({ minute: 60, awayReds: 1 }));
    expect(red.markets[0]!.fairProb["HOME"]!).toBeGreaterThan(base.markets[0]!.fairProb["HOME"]!);
  });

  it("pressure nudges price within the policy bound", () => {
    const pricer = new TissuePricer({ home: 0.5, draw: 0.28, away: 0.22, totals: { line: 2.5, over: 0.52 } }, policy);
    const neutral = pricer.price(state({ minute: 30 }));
    const pressured = pricer.price(state({ minute: 30, homePressure: 1 }));
    expect(pressured.markets[0]!.fairProb["HOME"]!).toBeGreaterThanOrEqual(neutral.markets[0]!.fairProb["HOME"]!);
  });
});

describe("fixed-point invariants", () => {
  it("every market's fair probs are integer bps summing to exactly 10000", () => {
    const pricer = new TissuePricer({ home: 0.48, draw: 0.29, away: 0.23, totals: { line: 2.5, over: 0.5 } }, policy);
    for (const minute of [0, 23, 45, 60, 80, 90]) {
      const p = pricer.price(state({ minute, homeScore: 1, awayScore: 1, awayReds: 1 }));
      for (const mk of p.markets) {
        const vals = Object.values(mk.fairProb);
        for (const v of vals) expect(Number.isInteger(v)).toBe(true);
        expect(vals.reduce((s, v) => s + v, 0)).toBe(10000);
      }
    }
  });

  it("pricing is deterministic (byte-identical across two runs)", () => {
    const mk = () =>
      new TissuePricer({ home: 0.5, draw: 0.28, away: 0.22, totals: { line: 2.5, over: 0.52 } }, policy).price(
        state({ minute: 55, homeScore: 1, awayScore: 0 }),
      );
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe("property test against the corpus", () => {
  it("prices every score state in SYN-QF1 to valid, finite, deterministic bps", () => {
    const corpus = readCorpus(SYNTHETIC_FIXTURE_ID);
    // opening line = first 1X2 odds message
    const opening = corpus.find((m) => m.kind === "odds" && m.marketKey.market === "1X2");
    if (!opening || opening.kind !== "odds") throw new Error("no opening 1X2");
    const totals = corpus.find((m) => m.kind === "odds" && m.marketKey.market === "TOTALS");
    const inp = {
      home: opening.consensus["HOME"]! / 10000,
      draw: opening.consensus["DRAW"]! / 10000,
      away: opening.consensus["AWAY"]! / 10000,
      ...(totals && totals.kind === "odds"
        ? { totals: { line: 2.5, over: totals.consensus["OVER"]! / 10000 } }
        : {}),
    };
    const pricer = new TissuePricer(inp, policy);

    let cur = { minute: 0, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 };
    const priced: string[] = [];
    for (const msg of corpus) {
      if (msg.kind === "score") {
        cur = {
          minute: msg.minute,
          homeScore: msg.homeScore,
          awayScore: msg.awayScore,
          homeReds: msg.homeReds,
          awayReds: msg.awayReds,
        };
      }
      const p = pricer.price(state(cur));
      for (const mk of p.markets) {
        const vals = Object.values(mk.fairProb);
        expect(vals.reduce((s, v) => s + v, 0)).toBe(10000);
        for (const v of vals) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(10000);
        }
      }
      priced.push(JSON.stringify(p.markets));
    }
    // determinism across a full re-run
    const pricer2 = new TissuePricer(inp, policy);
    let cur2 = { minute: 0, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 };
    const priced2: string[] = [];
    for (const msg of corpus) {
      if (msg.kind === "score") {
        cur2 = { minute: msg.minute, homeScore: msg.homeScore, awayScore: msg.awayScore, homeReds: msg.homeReds, awayReds: msg.awayReds };
      }
      priced2.push(JSON.stringify(pricer2.price(state(cur2)).markets));
    }
    expect(priced2).toEqual(priced);
  });
});
