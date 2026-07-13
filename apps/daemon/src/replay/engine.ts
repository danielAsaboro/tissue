import {
  type FeedMessage,
  type HaltSignal,
  type Intent,
  type Network,
  type OddsMessage,
  type RadarClass,
  type RadarEvent,
  type Selection,
  marketKeyString,
  probToMilliOdds,
  bps,
} from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { hashPayload } from "../ledger/hash.js";
import { Ledger } from "../ledger/ledger.js";
import { MatchState } from "../state/matchState.js";
import { TissuePricer } from "../tissue/index.js";
import { Radar } from "../radar/radar.js";
import { computeEdges, proposeQuotes } from "../strategy/strategy.js";
import { evaluateRisk } from "../risk/gates.js";
import { ExposureTracker } from "../risk/exposure.js";
import { SimulatedBook } from "../exec/simulatedBook.js";
import { prepareOddsAnchor, type PreparedAnchor } from "../exec/anchor.js";

/**
 * The deterministic decision loop (PRD §3). Both the live daemon and the replay lab run
 * THIS engine — that is what makes `replay(corpus) === ledger` meaningful. It is pure with
 * respect to (corpus, policy): no wall-clock, no I/O, message-id/feed-ts ordering only.
 */

export interface QuoteRecord {
  readonly msgId: string;
  readonly ts: number;
  readonly marketKey: string;
  readonly selection: Selection;
  readonly side: "BACK" | "LAY";
  readonly quoteMilliOdds: number;
  readonly quoteProbBps: number;
  readonly radarClass: RadarClass | undefined;
  matched: boolean;
}

export interface EngineResult {
  readonly fixtureId: string;
  readonly ledger: Ledger;
  readonly radarEvents: RadarEvent[];
  readonly halts: HaltSignal[];
  readonly anchors: PreparedAnchor[];
  readonly book: SimulatedBook;
  readonly quotes: QuoteRecord[];
  readonly forecasts: ForecastPoint[];
  readonly finalScore: { home: number; away: number };
  readonly closingMarket: Map<string, OddsMessage>;
}

/** A tissue 1X2 forecast at one reprice — the input to Brier/calibration grading. */
export interface ForecastPoint {
  readonly homeProbBps: number;
  readonly drawProbBps: number;
  readonly awayProbBps: number;
}

const SIM_COUNTERPARTY = "sim-book";

export interface EngineOptions {
  /**
   * Whether inter-message time gaps hard-HALT the desk (feed-death safety). Off by default:
   * a sampled snapshot corpus legitimately has minute-scale gaps that are NOT feed death.
   * The live daemon and the feed-gap chaos drill set this true. Staleness still widens
   * spreads regardless.
   */
  readonly feedGapHalt?: boolean;
}

export function runEngine(
  corpus: readonly FeedMessage[],
  policy: Policy,
  network: Network = "devnet",
  opts: EngineOptions = {},
): EngineResult {
  const feedGapHalt = opts.feedGapHalt ?? false;
  const ledger = new Ledger();
  const radar = new Radar(policy);
  const book = new SimulatedBook();
  const exposure = new ExposureTracker(policy.risk.exposure_cap_per_fixture_units);
  const state = new MatchState(policy);
  const market = new Map<string, OddsMessage>();
  let prevTs: number | null = null;

  const radarEvents: RadarEvent[] = [];
  const halts: HaltSignal[] = [];
  const anchors: PreparedAnchor[] = [];
  const quotes: QuoteRecord[] = [];
  const forecasts: ForecastPoint[] = [];

  let pricer: TissuePricer | null = null;
  let killed = false;
  let openingHome: OddsMessage | null = null;
  let openingTotals: OddsMessage | null = null;
  const fixtureId = corpus.find((m) => m)?.fixtureId ?? "UNKNOWN";
  let anchorTick = 0;

  for (const msg of corpus) {
    // Inter-message staleness (data-driven, deterministic). Widens spreads always; only
    // hard-halts when feedGapHalt is enabled (live / chaos drill).
    const stalenessMs = prevTs == null ? 0 : Math.max(0, msg.ts - prevTs);
    prevTs = msg.ts;
    const feedGapMs = feedGapHalt ? stalenessMs : 0;
    const rout = radar.observe(msg);
    radarEvents.push(...rout.events);
    halts.push(...rout.halts);

    if (msg.kind === "score") {
      state.applyScore(msg);
    } else {
      market.set(marketKeyString(msg.marketKey), msg);
      if (msg.marketKey.market === "1X2" && !openingHome) openingHome = msg;
      if (msg.marketKey.market === "TOTALS" && !openingTotals) openingTotals = msg;
      if (!pricer && openingHome) pricer = buildPricer(openingHome, openingTotals, policy);
      simulateExternalFlow(book, msg, exposure, quotes);
      if (shouldAnchor(policy, anchorTick++)) anchors.push(prepareOddsAnchor(network, msg.ts));
    }

    if (!pricer) {
      appendRecord(ledger, msg, network, state, exposure, stalenessMs, "NO_ACTION", undefined, undefined, bps(0), bps(0), 0, []);
      continue;
    }

    const priced = pricer.price(state.tissueState(msg.ts));
    const oneX2 = priced.markets.find((m) => m.marketKey.market === "1X2");
    if (oneX2) {
      forecasts.push({
        homeProbBps: oneX2.fairProb["HOME"] ?? 0,
        drawProbBps: oneX2.fairProb["DRAW"] ?? 0,
        awayProbBps: oneX2.fairProb["AWAY"] ?? 0,
      });
    }
    const edges = computeEdges(priced, market);
    const radarClass = latestRadarClass(rout.events);
    const inventoryNorm = inventoryNorms(exposure, priced, policy);
    const proposals = proposeQuotes(
      { priced, market, inventoryNorm, stalenessMs, radarClass },
      policy,
    );
    const risk = evaluateRisk(
      proposals,
      { feedGapMs, radarHalts: rout.halts, edges, exposure: exposure.snapshot(), killed },
      policy,
    );
    killed = killed || risk.killed;

    // Apply halts (ALL-scope ⇒ cancel every open intent, SAFE).
    const hasAllHalt = risk.halts.some((h) => h.scope === "ALL");
    if (hasAllHalt) {
      for (const i of book.openIntents()) {
        const c = book.cancelIntent(i.id);
        if (c) exposure.upsertOpen(c);
      }
    }
    const marketHaltKeys = new Set(
      risk.halts.filter((h) => h.scope === "MARKET" && h.marketKey).map((h) => marketKeyString(h.marketKey!)),
    );
    for (const i of book.openIntents()) {
      if (marketHaltKeys.has(marketKeyString(i.marketKey))) {
        const c = book.cancelIntent(i.id);
        if (c) exposure.upsertOpen(c);
      }
    }

    const posted: Intent[] = [];
    for (const p of risk.approved) {
      const intent = book.postIntent(p, fixtureId, msg.msgId);
      exposure.upsertOpen(intent);
      posted.push(intent);
      quotes.push({
        msgId: msg.msgId,
        ts: msg.ts,
        marketKey: marketKeyString(p.marketKey),
        selection: p.selection,
        side: p.side,
        quoteMilliOdds: p.priceMilliOdds,
        quoteProbBps: probBpsFromMilliOdds(p.priceMilliOdds),
        radarClass: p.radarClass,
        matched: false,
      });
    }

    const top = topEdge(edges);
    const action = hasAllHalt || marketHaltKeys.size > 0 ? "HALT" : posted.length > 0 ? "POST" : "NO_ACTION";
    appendRecord(
      ledger,
      msg,
      network,
      state,
      exposure,
      stalenessMs,
      action,
      radarClass,
      risk.halts[0]?.reason,
      top ? top.tissueProb : bps(0),
      top ? top.marketProb : bps(0),
      top ? top.edgeBps : 0,
      posted,
    );
  }

  const finalScore = lastScore(corpus);
  const settlement = book.settle(finalScore.home, finalScore.away);
  exposure.onSettle(settlement.totalPnlUnits);
  markMatchedQuotes(book, quotes);

  return { fixtureId, ledger, radarEvents, halts, anchors, book, quotes, forecasts, finalScore, closingMarket: market };
}

function buildPricer(home: OddsMessage, totals: OddsMessage | null, policy: Policy): TissuePricer {
  const h = home.consensus;
  const inp = {
    home: (h["HOME"] ?? 0) / 10000,
    draw: (h["DRAW"] ?? 0) / 10000,
    away: (h["AWAY"] ?? 0) / 10000,
    ...(totals ? { totals: { line: (totals.marketKey.lineTimes10 ?? 25) / 10, over: (totals.consensus["OVER"] ?? 0) / 10000 } } : {}),
  };
  return new TissuePricer(inp, policy);
}

function inventoryNorms(exposure: ExposureTracker, priced: ReturnType<TissuePricer["price"]>, policy: Policy): Map<string, number> {
  const m = new Map<string, number>();
  for (const mk of priced.markets) {
    for (const sel of Object.keys(mk.fairProb)) {
      const key = `${marketKeyString(mk.marketKey)}:${sel}`;
      m.set(key, exposure.inventoryNorm(key, policy.risk.exposure_cap_per_market_units));
    }
  }
  return m;
}

function latestRadarClass(events: readonly RadarEvent[]): RadarClass | undefined {
  return events.length ? events[events.length - 1]!.signalClass : undefined;
}

function topEdge(edges: readonly { tissueProb: number; marketProb: number; edgeBps: number }[]) {
  let top: { tissueProb: number; marketProb: number; edgeBps: number } | null = null;
  for (const e of edges) if (!top || Math.abs(e.edgeBps) > Math.abs(top.edgeBps)) top = e;
  return top as { tissueProb: ReturnType<typeof bps>; marketProb: ReturnType<typeof bps>; edgeBps: number } | null;
}

/** Implied probability (bps) of a milli-odds price. */
function probBpsFromMilliOdds(priceMilliOdds: number): number {
  return priceMilliOdds <= 0 ? 0 : Math.round((1000 / priceMilliOdds) * 10000);
}

function shouldAnchor(policy: Policy, tick: number): boolean {
  const rate = policy.exec.anchor_sample_rate;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const period = Math.max(1, Math.round(1 / rate));
  return tick % period === 0;
}

/**
 * Deterministic external-flow simulation for the replay/demo book. For each Tissue intent
 * on the just-updated market whose price the market crosses, a scripted counterparty
 * (owner "sim-book") takes half the remaining size. Clearly simulated — never a real fill.
 */
function simulateExternalFlow(
  book: SimulatedBook,
  msg: OddsMessage,
  exposure: ExposureTracker,
  quotes: QuoteRecord[],
): void {
  const key = marketKeyString(msg.marketKey);
  for (const intent of book.openIntents()) {
    if (marketKeyString(intent.marketKey) !== key) continue;
    const sel = intent.selection;
    const marketMilli = msg.rawOdds?.[sel] ?? probToMilliOdds(msg.consensus[sel] ?? bps(1));
    const remaining = intent.sizeUnits - intent.filledUnits;
    if (remaining <= 0) continue;
    const takerSide = intent.side === "BACK" ? "LAY" : "BACK";
    const fills = book.submitExternal({
      owner: SIM_COUNTERPARTY,
      marketKey: intent.marketKey,
      selection: sel,
      side: takerSide,
      priceMilliOdds: marketMilli,
      sizeUnits: Math.max(1, Math.floor(remaining / 2)),
    });
    for (const f of fills) exposure.onFill({ ...intent, side: f.tissueSide }, f.sizeUnits);
  }
}

function markMatchedQuotes(book: SimulatedBook, quotes: QuoteRecord[]): void {
  const matchedIds = new Set(book.allFills().map((f) => f.tissueIntentId));
  const intentByQuote = new Map<string, string>();
  for (const i of book.allIntents()) intentByQuote.set(`${i.createdMsgId}:${marketKeyString(i.marketKey)}:${i.selection}:${i.side}`, i.id);
  for (const q of quotes) {
    const id = intentByQuote.get(`${q.msgId}:${q.marketKey}:${q.selection}:${q.side}`);
    if (id && matchedIds.has(id)) q.matched = true;
  }
}

function lastScore(corpus: readonly FeedMessage[]): { home: number; away: number } {
  for (let i = corpus.length - 1; i >= 0; i--) {
    const m = corpus[i]!;
    if (m.kind === "score") return { home: m.homeScore, away: m.awayScore };
  }
  return { home: 0, away: 0 };
}

function appendRecord(
  ledger: Ledger,
  msg: FeedMessage,
  network: Network,
  state: MatchState,
  exposure: ExposureTracker,
  feedGapMs: number,
  action: "POST" | "NO_ACTION" | "HALT",
  radarClass: RadarClass | undefined,
  haltReason: string | undefined,
  tissueProb: ReturnType<typeof bps>,
  marketProb: ReturnType<typeof bps>,
  edgeBps: number,
  intents: readonly Intent[],
): void {
  ledger.append({
    triggerMsgId: msg.msgId,
    triggerHash: hashPayload(msg),
    triggerNetwork: network,
    ts: msg.ts,
    action,
    ...(radarClass ? { radarClass } : {}),
    ...(haltReason ? { haltReason } : {}),
    state: {
      minute: state.minute,
      homeScore: state.homeScore,
      awayScore: state.awayScore,
      homeReds: state.homeReds,
      awayReds: state.awayReds,
      inventory: exposure.inventorySnapshot(),
      exposure: exposure.snapshot(),
      feedGapMs,
    },
    tissueProb,
    marketProb,
    edgeBps,
    intents,
    simulated: true,
  });
}
