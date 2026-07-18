import type { GradeSheet } from "@tissue/shared";

/**
 * Public Grade Card (P1 trust surface, "receipts over promises"). A self-contained,
 * shareable SVG — no headless-browser/canvas dependency, deterministic given the same
 * GradeSheet — summarizing the numbers that matter for an X-native trust post: CLV, Brier,
 * halt count, and per-signal-class hit rates. Pulls only already-computed grader.ts output;
 * invents nothing.
 */

export interface GradeCardInput {
  readonly fixtureId: string;
  readonly network: string;
  readonly sheet: GradeSheet;
  readonly haltCount: number;
  readonly finalScore: { readonly home: number; readonly away: number };
  readonly generatedAt: string;
}

const WIDTH = 1200;
const HEIGHT = 630; // OG-image aspect ratio, doubles as a social card

const CARBON = "#181925";
const PAPER = "#ffffff";
const FOG = "#e8e8e8";
const LAVENDER = "#918df6";
const ASH = "#6b6b76";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function renderGradeCardSvg(input: GradeCardInput): string {
  const { fixtureId, network, sheet, haltCount, finalScore, generatedAt } = input;
  const rows = sheet.perClass.slice(0, 5);
  const rowY = (i: number) => 430 + i * 30;

  const perClassRows = rows
    .map(
      (row, i) => `
    <text x="60" y="${rowY(i)}" font-size="15" fill="${CARBON}" font-family="ui-monospace, monospace">${esc(row.signalClass)}</text>
    <text x="420" y="${rowY(i)}" font-size="15" fill="${ASH}" text-anchor="end" font-family="ui-monospace, monospace">n=${row.n}</text>
    <text x="560" y="${rowY(i)}" font-size="15" fill="${ASH}" text-anchor="end" font-family="ui-monospace, monospace">${(row.hitRate * 100).toFixed(0)}% hit</text>
    <text x="720" y="${rowY(i)}" font-size="15" fill="${CARBON}" text-anchor="end" font-family="ui-monospace, monospace">${signed(row.meanClvBps)}bps</text>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${LAVENDER}"/>

  <text x="60" y="80" font-size="15" letter-spacing="3" fill="${ASH}" font-family="ui-sans-serif, system-ui">TISSUE · DESK GRADE CARD</text>
  <text x="60" y="130" font-size="34" font-weight="700" fill="${CARBON}" font-family="ui-sans-serif, system-ui">Fixture ${esc(fixtureId)}</text>
  <text x="60" y="160" font-size="16" fill="${ASH}" font-family="ui-sans-serif, system-ui">${esc(network)} · final score ${finalScore.home}-${finalScore.away} · generated ${esc(generatedAt)}</text>

  <line x1="60" y1="185" x2="${WIDTH - 60}" y2="185" stroke="${FOG}"/>

  <!-- headline metrics -->
  <text x="60" y="240" font-size="13" letter-spacing="2" fill="${ASH}" font-family="ui-sans-serif, system-ui">MEAN CLV</text>
  <text x="60" y="280" font-size="40" font-weight="700" fill="${sheet.clv.meanClvBps >= 0 ? LAVENDER : "#e0245e"}" font-family="ui-monospace, monospace">${signed(sheet.clv.meanClvBps)}bps</text>
  <text x="60" y="305" font-size="13" fill="${ASH}" font-family="ui-sans-serif, system-ui">n=${sheet.clv.n} · ${(sheet.clv.pctPositive * 100).toFixed(0)}% positive</text>

  <text x="360" y="240" font-size="13" letter-spacing="2" fill="${ASH}" font-family="ui-sans-serif, system-ui">BRIER SCORE</text>
  <text x="360" y="280" font-size="40" font-weight="700" fill="${CARBON}" font-family="ui-monospace, monospace">${sheet.brier.brier.toFixed(4)}</text>
  <text x="360" y="305" font-size="13" fill="${ASH}" font-family="ui-sans-serif, system-ui">reliability ${sheet.brier.reliability.toFixed(3)} · resolution ${sheet.brier.resolution.toFixed(3)}</text>

  <text x="660" y="240" font-size="13" letter-spacing="2" fill="${ASH}" font-family="ui-sans-serif, system-ui">HALTS</text>
  <text x="660" y="280" font-size="40" font-weight="700" fill="${CARBON}" font-family="ui-monospace, monospace">${haltCount}</text>
  <text x="660" y="305" font-size="13" fill="${ASH}" font-family="ui-sans-serif, system-ui">adverse-selection + feed-gap</text>

  <text x="920" y="240" font-size="13" letter-spacing="2" fill="${ASH}" font-family="ui-sans-serif, system-ui">REALIZED PNL</text>
  <text x="920" y="280" font-size="34" font-weight="700" fill="${CARBON}" font-family="ui-monospace, monospace">${sheet.pnl.realizedUnits.toLocaleString("en-US")}</text>
  <text x="920" y="305" font-size="13" fill="${ASH}" font-family="ui-sans-serif, system-ui">${sheet.pnl.simulated ? "SIMULATED (replay)" : "live output"} · ${sheet.pnl.matchedIntents} matched</text>

  <line x1="60" y1="340" x2="${WIDTH - 60}" y2="340" stroke="${FOG}"/>
  <text x="60" y="375" font-size="13" letter-spacing="2" fill="${ASH}" font-family="ui-sans-serif, system-ui">PER-SIGNAL-CLASS HIT RATE</text>
${perClassRows || `<text x="60" y="430" font-size="15" fill="${ASH}" font-family="ui-sans-serif, system-ui">No per-class samples yet.</text>`}

  <text x="60" y="590" font-size="13" fill="${ASH}" font-family="ui-sans-serif, system-ui">Fill-independent. No fake fills. Hash-chained, replay-verified.</text>
</svg>`;
}
