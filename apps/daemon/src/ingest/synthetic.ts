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
 * Deterministic synthetic World Cup match. NO randomness — a fixed scripted timeline with
 * SECOND-level timestamps, so the corpus is byte-identical every run (replay-equality and
 * the Radar's latency measurement both depend on this).
 *
 * The market path is INDEPENDENT of the tissue model (a scripted "other side" of the book).
 * It reacts to events with realistic, deliberately-varied latency so the Radar has genuine
 * signals to classify:
 *   - 40:00 GOAL home  → fast reaction at 40:06  (fast-reaction)
 *   - 60:00 RED  away  → slower reaction at 60:14 (late-ish, exercises the band)
 *   - 78:00 GOAL away  → reaction at 78:07, then an 82:xx overreaction+retrace
 *   - 30:12 a market move with NO preceding event → unexplained-movement (HALT drill)
 */

const BASE_TS = 1_720_000_000_000;
const tsAt = (min: number, sec = 0) => BASE_TS + (min * 60 + sec) * 1000;

interface Mkt {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
  readonly over: number;
  readonly under: number;
}

interface ScorePoint {
  readonly min: number;
  readonly sec?: number;
  readonly status: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly homeReds: number;
  readonly awayReds: number;
  readonly pressureHome?: PressureClass;
  readonly pressureAway?: PressureClass;
  readonly isFinal?: boolean;
}

interface OddsPoint {
  readonly min: number;
  readonly sec?: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly market: Mkt;
  readonly inRunning: boolean;
}

const SCORE_POINTS: ScorePoint[] = [
  { min: 0, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 10, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 23, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0, pressureHome: "high_danger" },
  { min: 30, status: STATUS.H1, homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 40, status: STATUS.H1, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0 }, // GOAL home
  { min: 45, status: STATUS.HT, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 46, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 55, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 0 },
  { min: 60, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 1 }, // RED away
  { min: 70, status: STATUS.H2, homeScore: 1, awayScore: 0, homeReds: 0, awayReds: 1, pressureAway: "danger" },
  { min: 78, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1 }, // GOAL away
  { min: 88, status: STATUS.H2, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1 },
  { min: 90, status: STATUS.FINALISED, homeScore: 1, awayScore: 1, homeReds: 0, awayReds: 1, isFinal: true },
];

const PRE: Mkt = { home: 0.5, draw: 0.28, away: 0.22, over: 0.52, under: 0.48 };
const ODDS_POINTS: OddsPoint[] = [
  { min: 0, homeScore: 0, awayScore: 0, market: PRE, inRunning: false },
  { min: 10, homeScore: 0, awayScore: 0, market: { home: 0.51, draw: 0.28, away: 0.21, over: 0.5, under: 0.5 }, inRunning: true },
  { min: 23, homeScore: 0, awayScore: 0, market: { home: 0.52, draw: 0.28, away: 0.2, over: 0.49, under: 0.51 }, inRunning: true },
  // UNEXPLAINED: a move at 30:12 with no preceding event in the trailing window.
  { min: 30, sec: 12, homeScore: 0, awayScore: 0, market: { home: 0.58, draw: 0.26, away: 0.16, over: 0.48, under: 0.52 }, inRunning: true },
  // GOAL home 40:00 → fast reaction 40:06.
  { min: 40, sec: 6, homeScore: 1, awayScore: 0, market: { home: 0.64, draw: 0.24, away: 0.12, over: 0.56, under: 0.44 }, inRunning: true },
  { min: 43, homeScore: 1, awayScore: 0, market: { home: 0.66, draw: 0.23, away: 0.11, over: 0.57, under: 0.43 }, inRunning: true },
  { min: 55, homeScore: 1, awayScore: 0, market: { home: 0.69, draw: 0.21, away: 0.1, over: 0.54, under: 0.46 }, inRunning: true },
  // RED away 60:00 → slower reaction 60:14.
  { min: 60, sec: 14, homeScore: 1, awayScore: 0, market: { home: 0.77, draw: 0.16, away: 0.07, over: 0.55, under: 0.45 }, inRunning: true },
  { min: 70, homeScore: 1, awayScore: 0, market: { home: 0.78, draw: 0.16, away: 0.06, over: 0.53, under: 0.47 }, inRunning: true },
  // GOAL away 78:00 → first reaction 78:06, overshoot 78:12, ≥50% retrace 78:18
  // (all inside the 20s window so the Radar attributes the whole overreaction to the goal).
  { min: 78, sec: 6, homeScore: 1, awayScore: 1, market: { home: 0.52, draw: 0.34, away: 0.14, over: 0.68, under: 0.32 }, inRunning: true },
  { min: 78, sec: 12, homeScore: 1, awayScore: 1, market: { home: 0.42, draw: 0.4, away: 0.18, over: 0.8, under: 0.2 }, inRunning: true },
  { min: 78, sec: 18, homeScore: 1, awayScore: 1, market: { home: 0.62, draw: 0.26, away: 0.12, over: 0.7, under: 0.3 }, inRunning: true },
  // Settle near the retrace level (small drift) — not a fresh unexplained move.
  { min: 88, homeScore: 1, awayScore: 1, market: { home: 0.61, draw: 0.27, away: 0.12, over: 0.71, under: 0.29 }, inRunning: true },
];

let SEQ = 0;
const nextId = (fixtureId: string) => `SYN:${fixtureId}:${String(++SEQ).padStart(5, "0")}`;

function scoreMsg(p: ScorePoint, fixtureId: string): ScoreMessage {
  return {
    kind: "score",
    msgId: nextId(fixtureId),
    fixtureId,
    ts: millis(tsAt(p.min, p.sec ?? 0)),
    network: "devnet",
    minute: p.min,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    homeReds: p.homeReds,
    awayReds: p.awayReds,
    possession: { home: p.pressureHome ?? "none", away: p.pressureAway ?? "none" },
    phase: String(p.status),
    isFinal: Boolean(p.isFinal),
  };
}

const toMilli = (p: number) => milliOdds(Math.round((1 / Math.max(p, 1e-4)) * 1000));

function odds1x2(p: OddsPoint, fixtureId: string): OddsMessage {
  const m = p.market;
  const s = m.home + m.draw + m.away;
  const consensus = {
    HOME: bps(Math.round((m.home / s) * 10000)),
    DRAW: bps(Math.round((m.draw / s) * 10000)),
    AWAY: bps(Math.round((m.away / s) * 10000)),
  } as ProbVector;
  return {
    kind: "odds",
    msgId: nextId(fixtureId),
    fixtureId,
    ts: millis(tsAt(p.min, p.sec ?? 0)),
    network: "devnet",
    marketKey: { market: "1X2" },
    consensus,
    rawOdds: { HOME: toMilli(m.home / s), DRAW: toMilli(m.draw / s), AWAY: toMilli(m.away / s) },
    inRunning: p.inRunning,
  };
}

function oddsTotals(p: OddsPoint, fixtureId: string): OddsMessage {
  const m = p.market;
  const s = m.over + m.under;
  const consensus = {
    OVER: bps(Math.round((m.over / s) * 10000)),
    UNDER: bps(Math.round((m.under / s) * 10000)),
  } as ProbVector;
  return {
    kind: "odds",
    msgId: nextId(fixtureId),
    fixtureId,
    ts: millis(tsAt(p.min, (p.sec ?? 0) + 1)),
    network: "devnet",
    marketKey: { market: "TOTALS", lineTimes10: 25 },
    consensus,
    rawOdds: { OVER: toMilli(m.over / s), UNDER: toMilli(m.under / s) },
    inRunning: p.inRunning,
  };
}

/** Build the full ordered corpus (by feed ts). Deterministic. */
export function generateSyntheticCorpus(fixtureId = "SYN-QF1"): FeedMessage[] {
  SEQ = 0;
  const msgs: FeedMessage[] = [];
  for (const p of SCORE_POINTS) msgs.push(scoreMsg(p, fixtureId));
  for (const p of ODDS_POINTS) {
    msgs.push(odds1x2(p, fixtureId));
    msgs.push(oddsTotals(p, fixtureId));
  }
  // Order by feed ts, then msgId — the canonical feed order the daemon would see live.
  return msgs.sort((a, b) => a.ts - b.ts || (a.msgId < b.msgId ? -1 : a.msgId > b.msgId ? 1 : 0));
}

export const SYNTHETIC_FIXTURE_ID = "SYN-QF1";
