import {
  type FeedMessage,
  type OddsMessage,
  type ScoreMessage,
  type PressureClass,
  bps,
  millis,
  milliOdds,
  type ProbVector,
} from "@tissue/shared";
import { STATUS } from "./soccerFeed.js";

/**
 * Deterministic synthetic World Cup match. NO randomness — a fixed scripted timeline, so
 * the corpus is byte-identical every run (replay-equality depends on this). It exists so
 * the pricing core, Radar, and replay have real-shaped input before/without live capture.
 *
 * The market path here is INDEPENDENT of the tissue model (it is a scripted "other side"
 * of the book), and deliberately reacts to events with a lag so the Radar has genuine
 * event→reaction gaps to classify. See seedCorpus.ts for the live alternative.
 */

const BASE_TS = 1_720_000_000_000;
const MS_PER_MIN = 60_000;

interface MarketProbs {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
  readonly over: number;
  readonly under: number;
}

interface Frame {
  readonly minute: number;
  readonly status: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeReds: number;
  readonly awayReds: number;
  readonly pressureHome?: PressureClass;
  readonly pressureAway?: PressureClass;
  /** Market consensus at this minute (the scripted counter-party path). */
  readonly market: MarketProbs;
  readonly isFinal?: boolean;
}

/**
 * Scripted minute-by-minute path. Market reacts to the 40' goal starting 41', the 60'
 * red starting 61', the 78' equalizer starting 79', with an 82'-84' overreaction+retrace.
 */
const TIMELINE: Frame[] = [
  { minute: 0, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.5, draw: 0.28, away: 0.22, over: 0.52, under: 0.48 } },
  { minute: 10, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.51, draw: 0.28, away: 0.21, over: 0.5, under: 0.5 } },
  { minute: 23, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, pressureHome: "high_danger", market: { home: 0.52, draw: 0.28, away: 0.2, over: 0.49, under: 0.51 } },
  { minute: 30, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.52, draw: 0.28, away: 0.2, over: 0.47, under: 0.53 } },
  // GOAL home at 40' — market still lagging this minute.
  { minute: 40, status: STATUS.H1, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.52, draw: 0.28, away: 0.2, over: 0.47, under: 0.53 } },
  { minute: 41, status: STATUS.H1, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.62, draw: 0.24, away: 0.14, over: 0.55, under: 0.45 } },
  { minute: 43, status: STATUS.H1, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.66, draw: 0.23, away: 0.11, over: 0.57, under: 0.43 } },
  { minute: 45, status: STATUS.HT, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.66, draw: 0.23, away: 0.11, over: 0.55, under: 0.45 } },
  { minute: 46, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.67, draw: 0.22, away: 0.11, over: 0.56, under: 0.44 } },
  { minute: 55, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0, market: { home: 0.69, draw: 0.21, away: 0.1, over: 0.54, under: 0.46 } },
  // RED away at 60' — market reacts 61'.
  { minute: 60, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 1, market: { home: 0.69, draw: 0.21, away: 0.1, over: 0.54, under: 0.46 } },
  { minute: 61, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 1, market: { home: 0.76, draw: 0.17, away: 0.07, over: 0.56, under: 0.44 } },
  { minute: 70, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 1, pressureAway: "danger", market: { home: 0.78, draw: 0.16, away: 0.06, over: 0.53, under: 0.47 } },
  // GOAL away at 78' (against the run) — 1-1.
  { minute: 78, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, market: { home: 0.78, draw: 0.16, away: 0.06, over: 0.53, under: 0.47 } },
  { minute: 79, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, market: { home: 0.55, draw: 0.33, away: 0.12, over: 0.7, under: 0.3 } },
  // Overreaction spike at 82' then retrace by 84'.
  { minute: 82, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, market: { home: 0.44, draw: 0.4, away: 0.16, over: 0.78, under: 0.22 } },
  { minute: 84, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, market: { home: 0.53, draw: 0.34, away: 0.13, over: 0.71, under: 0.29 } },
  { minute: 88, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, market: { home: 0.56, draw: 0.33, away: 0.11, over: 0.72, under: 0.28 } },
  { minute: 90, status: STATUS.FINALISED, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, isFinal: true, market: { home: 0.56, draw: 0.33, away: 0.11, over: 0.72, under: 0.28 } },
];

let SEQ = 0;
function scoreMsg(f: Frame, fixtureId: string): ScoreMessage {
  const home: PressureClass = f.pressureHome ?? "none";
  const away: PressureClass = f.pressureAway ?? "none";
  return {
    kind: "score",
    msgId: `SYN:${fixtureId}:${String(++SEQ).padStart(5, "0")}`,
    fixtureId,
    ts: millis(BASE_TS + f.minute * MS_PER_MIN),
    network: "devnet",
    minute: f.minute,
    homeScore: f.homeScore,
    awayScore: f.awayScore,
    homeReds: f.homeReds,
    awayReds: f.awayReds,
    possession: { home, away },
    phase: String(f.status),
    isFinal: Boolean(f.isFinal),
  };
}

function toMilli(p: number) {
  return milliOdds(Math.round((1 / Math.max(p, 1e-4)) * 1000));
}

function oddsMsg1x2(f: Frame, fixtureId: string, offsetMs: number): OddsMessage {
  const m = f.market;
  const sum = m.home + m.draw + m.away;
  const consensus = {
    HOME: bps(Math.round((m.home / sum) * 10000)),
    DRAW: bps(Math.round((m.draw / sum) * 10000)),
    AWAY: bps(Math.round((m.away / sum) * 10000)),
  } as ProbVector;
  return {
    kind: "odds",
    msgId: `SYN:${fixtureId}:${String(++SEQ).padStart(5, "0")}`,
    fixtureId,
    ts: millis(BASE_TS + f.minute * MS_PER_MIN + offsetMs),
    network: "devnet",
    marketKey: { market: "1X2" },
    consensus,
    rawOdds: { HOME: toMilli(m.home / sum), DRAW: toMilli(m.draw / sum), AWAY: toMilli(m.away / sum) },
    inRunning: f.minute > 0 && !f.isFinal,
  };
}

function oddsMsgTotals(f: Frame, fixtureId: string, offsetMs: number): OddsMessage {
  const m = f.market;
  const sum = m.over + m.under;
  const consensus = {
    OVER: bps(Math.round((m.over / sum) * 10000)),
    UNDER: bps(Math.round((m.under / sum) * 10000)),
  } as ProbVector;
  return {
    kind: "odds",
    msgId: `SYN:${fixtureId}:${String(++SEQ).padStart(5, "0")}`,
    fixtureId,
    ts: millis(BASE_TS + f.minute * MS_PER_MIN + offsetMs),
    network: "devnet",
    marketKey: { market: "TOTALS", lineTimes10: 25 },
    consensus,
    rawOdds: { OVER: toMilli(m.over / sum), UNDER: toMilli(m.under / sum) },
    inRunning: f.minute > 0 && !f.isFinal,
  };
}

/** Build the full ordered corpus for a synthetic fixture. Deterministic. */
export function generateSyntheticCorpus(fixtureId = "SYN-QF1"): FeedMessage[] {
  SEQ = 0;
  const out: FeedMessage[] = [];
  for (const f of TIMELINE) {
    out.push(scoreMsg(f, fixtureId));
    out.push(oddsMsg1x2(f, fixtureId, 200));
    out.push(oddsMsgTotals(f, fixtureId, 400));
  }
  return out;
}

export const SYNTHETIC_FIXTURE_ID = "SYN-QF1";
