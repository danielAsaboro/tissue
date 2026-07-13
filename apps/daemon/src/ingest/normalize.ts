import {
  type FeedMessage,
  type OddsMessage,
  type PressureClass,
  type ScoreMessage,
  type Network,
  type MarketKey,
  type ProbVector,
  bps,
  millis,
  milliOdds,
  type MilliOdds,
} from "@tissue/shared";
import {
  PERIOD_PREFIX,
  PHASE_START_MINUTE,
  STAT_KEY,
  isFinalStatus,
  isVoidStatus,
  type FreeKickType,
} from "./soccerFeed.js";

/**
 * Raw → normalized. The rest of the daemon only sees `FeedMessage`.
 *
 * We have the on-chain `Odds` struct and the documented soccer stat-key table, but the
 * repo ships no literal scores/odds JSON sample (GROUND-TRUTH.md T2). So this normalizer
 * is defensive: it reads PascalCase feed keys with camelCase fallbacks, tolerates missing
 * fields, and documents every mapping assumption. When the hosted OpenAPI sample lands,
 * only this file changes.
 */

export interface RawScores {
  readonly [k: string]: unknown;
}
export interface RawOdds {
  readonly [k: string]: unknown;
}

function pick<T>(obj: Record<string, unknown>, keys: string[], fallback: T): T {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return fallback;
}

function statValue(stats: Record<string, unknown> | undefined, key: number): number {
  if (!stats) return 0;
  const v = stats[String(key)] ?? stats[key as unknown as string];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** Map a free_kick FreeKickType (or shot) to a momentary pressure class. */
export function freeKickToPressure(t: FreeKickType | string | undefined): PressureClass {
  switch (t) {
    case "HighDanger":
      return "high_danger";
    case "Danger":
      return "danger";
    case "Attack":
      return "attack";
    default:
      return "none";
  }
}

export function normalizeScores(raw: RawScores, network: Network): ScoreMessage | null {
  const r = raw as Record<string, unknown>;
  const fixtureId = String(pick(r, ["FixtureId", "fixtureId"], ""));
  if (!fixtureId) return null;

  const seq = pick<number>(r, ["Seq", "seq"], 0);
  const globalSeq = pick<number>(r, ["GlobalSeq", "globalSeq"], 0);
  const ts = pick<number>(r, ["Ts", "ts"], 0);
  const statusId = pick<number>(r, ["StatusId", "statusId", "status"], 0);
  const stats = pick<Record<string, unknown>>(r, ["Stats", "stats"], {});

  // Cumulative totals live under the TOTAL (0) period prefix.
  const homeScore = statValue(stats, PERIOD_PREFIX.TOTAL + STAT_KEY.P1_GOALS);
  const awayScore = statValue(stats, PERIOD_PREFIX.TOTAL + STAT_KEY.P2_GOALS);
  const homeReds = statValue(stats, PERIOD_PREFIX.TOTAL + STAT_KEY.P1_RED);
  const awayReds = statValue(stats, PERIOD_PREFIX.TOTAL + STAT_KEY.P2_RED);

  const explicitMinute = pick<number | undefined>(r, ["Minute", "minute"], undefined);
  const minute = explicitMinute ?? PHASE_START_MINUTE[statusId] ?? 0;

  // Momentary pressure from a free_kick / shot event if this message is one.
  const action = String(pick(r, ["action", "Action", "Type"], ""));
  const data = pick<Record<string, unknown>>(r, ["Data", "data"], {});
  const freeKickType = pick<string | undefined>(data, ["FreeKickType", "freeKickType"], undefined);
  const participant = pick<number>(data, ["Participant", "participant"], 0);
  let home: PressureClass = "none";
  let away: PressureClass = "none";
  if (action === "free_kick" || action === "shot") {
    const cls = freeKickToPressure(freeKickType);
    if (participant === 2) away = cls;
    else home = cls;
  }

  const msgId = String(pick(r, ["Id", "id"], "")) || `${fixtureId}:s:${globalSeq || seq}`;

  return {
    kind: "score",
    msgId,
    fixtureId,
    ts: millis(ts),
    network,
    ...(Number.isSafeInteger(seq) && seq > 0 ? { sourceSeq: seq } : {}),
    minute,
    homeScore,
    awayScore,
    homeReds,
    awayReds,
    possession: { home, away },
    phase: String(statusId),
    isFinal: isFinalStatus(statusId),
    isVoid: isVoidStatus(statusId),
  };
}

/**
 * Map super_odds_type → MarketId + selection names. StablePrice consensus feed.
 * price_names / prices are parallel arrays (prices are i32, decimal odds ×1000).
 */
function classifyMarket(superOddsType: string, marketParameters?: string): MarketKey | null {
  const t = superOddsType.toLowerCase();
  if (t.includes("1x2") || t.includes("match odds") || t.includes("moneyline") || t === "ml") {
    return { market: "1X2" };
  }
  if (t.includes("total") || t.includes("over") || t.includes("under") || t.includes("o/u")) {
    const line = parseLine(marketParameters);
    return line == null ? { market: "TOTALS" } : { market: "TOTALS", lineTimes10: line };
  }
  return null;
}

function parseLine(marketParameters?: string): number | undefined {
  if (!marketParameters) return undefined;
  const m = marketParameters.match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]!) * 10);
}

/** Normalize a price name to a canonical selection label. */
function canonicalSelection(name: string, market: MarketKey["market"]): string | null {
  const n = name.trim().toLowerCase();
  if (market === "1X2") {
    if (n === "1" || n === "home" || n === "h") return "HOME";
    if (n === "x" || n === "draw" || n === "d") return "DRAW";
    if (n === "2" || n === "away" || n === "a") return "AWAY";
  } else {
    if (n.startsWith("o") || n === "over") return "OVER";
    if (n.startsWith("u") || n === "under") return "UNDER";
  }
  return null;
}

export function normalizeOdds(raw: RawOdds, network: Network): OddsMessage | null {
  const r = raw as Record<string, unknown>;
  const fixtureId = String(pick(r, ["fixture_id", "FixtureId", "fixtureId"], ""));
  if (!fixtureId) return null;

  const superOddsType = String(pick(r, ["super_odds_type", "SuperOddsType"], ""));
  const marketParameters = pick<string | undefined>(
    r,
    ["market_parameters", "MarketParameters"],
    undefined,
  );
  const marketKey = classifyMarket(superOddsType, marketParameters);
  if (!marketKey) return null; // market we don't quote yet

  const priceNames = pick<string[]>(r, ["price_names", "PriceNames"], []);
  const prices = pick<number[]>(r, ["prices", "Prices"], []);
  if (priceNames.length === 0 || priceNames.length !== prices.length) return null;

  const rawOdds: Record<string, MilliOdds> = {};
  const impliedByName: Record<string, number> = {};
  for (let i = 0; i < priceNames.length; i++) {
    const sel = canonicalSelection(priceNames[i]!, marketKey.market);
    if (!sel) continue;
    const priceMilli = prices[i]!; // decimal odds ×1000
    if (priceMilli <= 0) continue;
    rawOdds[sel] = milliOdds(priceMilli);
    impliedByName[sel] = 1000 / priceMilli; // implied probability (0..1)
  }
  const selections = Object.keys(impliedByName);
  if (selections.length === 0) return null;
  // Require a COMPLETE selection set — real feeds carry partial/degenerate rows (e.g. a lone
  // "draw" leg) that must not become a one-sided market. (Hardened against live data.)
  if (marketKey.market === "1X2" && !(selections.includes("HOME") && selections.includes("AWAY"))) return null;
  if (marketKey.market === "TOTALS" && !(selections.includes("OVER") && selections.includes("UNDER"))) return null;

  // De-vig defensively (normalize implied probs to sum to 1). Idempotent on an already
  // de-margined StablePrice input; corrects any residual overround (GROUND-TRUTH T2).
  const overround = selections.reduce((s, k) => s + impliedByName[k]!, 0);
  const consensus: Record<string, ReturnType<typeof bps>> = {};
  for (const k of selections) {
    consensus[k] = bps(Math.round((impliedByName[k]! / overround) * 10000));
  }

  const msgId =
    String(pick(r, ["message_id", "MessageId"], "")) ||
    `${fixtureId}:o:${pick(r, ["ts", "Ts"], 0)}`;

  const base = {
    kind: "odds" as const,
    msgId,
    fixtureId,
    ts: millis(pick<number>(r, ["ts", "Ts"], 0)),
    network,
    marketKey,
    consensus: consensus as ProbVector,
    rawOdds,
    inRunning: Boolean(pick(r, ["in_running", "InRunning", "inRunning"], false)),
  };
  const bookmaker = pick<string | undefined>(r, ["bookmaker", "Bookmaker"], undefined);
  const bookmakerId = pick<number | undefined>(r, ["bookmaker_id", "BookmakerId"], undefined);
  return {
    ...base,
    ...(bookmaker !== undefined ? { bookmaker } : {}),
    ...(bookmakerId !== undefined ? { bookmakerId } : {}),
  };
}

export function normalize(
  kind: "score" | "odds",
  raw: RawScores | RawOdds,
  network: Network,
): FeedMessage | null {
  return kind === "score"
    ? normalizeScores(raw, network)
    : normalizeOdds(raw, network);
}
