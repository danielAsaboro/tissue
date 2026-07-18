import { describe, expect, it, beforeAll } from "vitest";
import { loadPolicy, type Policy } from "../config/policy.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";
import { runEngine } from "../replay/engine.js";
import { grade } from "./grader.js";
import { renderGradeCardSvg } from "./gradeCard.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("renderGradeCardSvg — real numbers, no fabrication", () => {
  it("renders a well-formed SVG containing the real headline metrics", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    const sheet = grade(result, policy);
    const card = renderGradeCardSvg({
      fixtureId: result.fixtureId,
      network: "devnet",
      sheet,
      haltCount: result.halts.length,
      finalScore: result.finalScore,
      generatedAt: "2026-07-18 00:00 UTC",
    });
    expect(card).toContain("<svg");
    expect(card).toContain("</svg>");
    expect(card).toContain(result.fixtureId);
    expect(card).toContain(sheet.brier.brier.toFixed(4));
    expect(card).toContain(String(result.halts.length));
  });

  it("escapes untrusted-shaped fixtureId text (no raw HTML injection)", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    const sheet = grade(result, policy);
    const card = renderGradeCardSvg({
      fixtureId: "<script>alert(1)</script>",
      network: "devnet",
      sheet,
      haltCount: 0,
      finalScore: { home: 0, away: 0 },
      generatedAt: "now",
    });
    expect(card).not.toContain("<script>");
    expect(card).toContain("&lt;script&gt;");
  });

  it("handles an empty per-class table without breaking the SVG", () => {
    const emptySheet = {
      generatedAtMsgId: "",
      clv: { n: 0, meanClvBps: 0, medianClvBps: 0, p25Bps: 0, p75Bps: 0, pctPositive: 0 },
      brier: { brier: 0, reliability: 0, resolution: 0, uncertainty: 0, bins: [] },
      latency: [],
      perClass: [],
      pnl: { realizedUnits: 0, matchedIntents: 0, settlementTxSigs: [], simulated: true },
    };
    const card = renderGradeCardSvg({
      fixtureId: "EMPTY",
      network: "devnet",
      sheet: emptySheet,
      haltCount: 0,
      finalScore: { home: 0, away: 0 },
      generatedAt: "now",
    });
    expect(card).toContain("No per-class samples yet.");
    expect(card).toContain("</svg>");
  });

  it("is deterministic — identical input, identical output", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    const sheet = grade(result, policy);
    const input = {
      fixtureId: result.fixtureId,
      network: "devnet",
      sheet,
      haltCount: result.halts.length,
      finalScore: result.finalScore,
      generatedAt: "2026-07-18 00:00 UTC",
    };
    expect(renderGradeCardSvg(input)).toBe(renderGradeCardSvg(input));
  });
});
