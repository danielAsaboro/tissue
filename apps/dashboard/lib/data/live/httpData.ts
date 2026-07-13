import type {
  DecisionRecord,
  ExposureSnapshot,
  GradeSheet,
  InventorySnapshot,
  Network,
  RadarEvent,
  TissuePrice,
} from "@tissue/shared";
import type {
  DashboardData,
  AnchorEvidenceRow,
  GaugeState,
  HaltState,
  QuoteTapeRow,
  ReplayControl,
  TissueVsMarketSeries,
} from "../types";

interface ApiQuote {
  readonly ts: number;
  readonly marketKey: string;
  readonly selection: string;
  readonly side: "BACK" | "LAY";
  readonly quoteMilliOdds: number;
  readonly sizeUnits: number;
  readonly sourceOddsMsgId: string;
  readonly matched: boolean;
}

interface ApiFixture {
  readonly fixtureId: string;
  readonly decisions: readonly DecisionRecord[];
  readonly quotes: readonly ApiQuote[];
  readonly radarEvents: readonly RadarEvent[];
  readonly grade: GradeSheet;
  readonly headHash: string;
  readonly hashChainOk: boolean;
  readonly anchors: readonly AnchorEvidenceRow[];
}

interface ApiState {
  readonly mode: "live";
  readonly execution: "quote-publication";
  readonly status: "starting" | "verifying" | "quoting" | "watching" | "halted" | "error";
  readonly network: Network;
  readonly activeFixtureId: string | null;
  readonly fixtures: readonly ApiFixture[];
  readonly error?: string;
}

const EMPTY_INVENTORY: InventorySnapshot = { bySelection: {}, netUnits: 0 };
const EMPTY_EXPOSURE: ExposureSnapshot = {
  perMarketUnits: {},
  perFixtureUnits: 0,
  openIntents: 0,
  realizedPnlUnits: 0,
  peakEquityUnits: 0,
  drawdownUnits: 0,
};

export class DashboardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardUnavailableError";
  }
}

export class HttpDashboardData implements DashboardData {
  readonly network: Network = process.env.TISSUE_NETWORK === "mainnet" ? "mainnet" : "devnet";
  private readonly baseUrl = process.env.TISSUE_DAEMON_URL ?? "http://127.0.0.1:8788";

  private async state(): Promise<ApiState> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/state`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new DashboardUnavailableError("The Tissue daemon is temporarily unavailable.");
    }
    if (!response.ok) {
      throw new DashboardUnavailableError(`The Tissue daemon returned HTTP ${response.status}.`);
    }
    return (await response.json()) as ApiState;
  }

  private active(state: ApiState): ApiFixture | null {
    return state.fixtures.find((fixture) => fixture.fixtureId === state.activeFixtureId) ?? state.fixtures[0] ?? null;
  }

  async getTissueVsMarket(): Promise<TissueVsMarketSeries> {
    const state = await this.state();
    const fixture = this.active(state);
    const records = fixture?.decisions ?? [];
    const firstIntent = records.flatMap((record) => record.intents).at(0);
    return {
      fixtureId: fixture?.fixtureId ?? "WAITING-FOR-TXLINE",
      marketLabel: firstIntent?.marketKey.market ?? "PRIMARY",
      selectionLabel: firstIntent?.selection ?? "TOP EDGE",
      points: records.map((record) => ({
        tsMs: record.ts,
        msgId: record.triggerMsgId,
        minute: record.state.minute,
        tissueProbBps: record.tissueProb,
        marketProbBps: record.marketProb,
      })),
    };
  }

  async getLatestTissue(): Promise<TissuePrice | null> {
    return null;
  }

  async getQuoteTape(): Promise<readonly QuoteTapeRow[]> {
    const state = await this.state();
    const fixture = this.active(state);
    const anchors = new Map((fixture?.anchors ?? []).map((evidence) => [evidence.messageId, evidence]));
    return (fixture?.quotes ?? []).map((quote) => ({
      tsMs: quote.ts,
      marketLabel: quote.marketKey,
      selectionLabel: quote.selection,
      side: quote.side,
      priceMilliOdds: quote.quoteMilliOdds,
      sizeUnits: quote.sizeUnits,
      status: quote.matched
        ? "Replay matched"
        : anchors.get(quote.sourceOddsMsgId)?.result
          ? "Published"
          : anchors.has(quote.sourceOddsMsgId)
            ? "Proof failed"
            : "Pending proof",
      simulated: quote.matched,
    }));
  }

  async getRadarEvents(): Promise<readonly RadarEvent[]> {
    const state = await this.state();
    return this.active(state)?.radarEvents ?? [];
  }

  async getGauges(): Promise<GaugeState> {
    const state = await this.state();
    const latest = this.active(state)?.decisions.at(-1);
    return {
      inventory: latest?.state.inventory ?? EMPTY_INVENTORY,
      exposure: latest?.state.exposure ?? EMPTY_EXPOSURE,
    };
  }

  async getHalt(): Promise<HaltState> {
    const state = await this.state();
    const latest = this.active(state)?.decisions.at(-1);
    return {
      kind: state.status === "starting" ? "waiting" : state.status,
      ...(state.status === "starting" ? { reason: "waiting for real TxLINE data" } : {}),
      ...(state.status === "halted" || state.status === "error"
        ? { reason: state.error ?? latest?.haltReason ?? "feed-gap" }
        : {}),
      ...(latest ? { sinceMsgId: latest.triggerMsgId } : {}),
    };
  }

  async getDecisionFeed(): Promise<readonly DecisionRecord[]> {
    const state = await this.state();
    return this.active(state)?.decisions ?? [];
  }

  async verifyHashChain(): Promise<{ ok: boolean; brokenAtSeq?: number }> {
    const response = await fetch(`${this.baseUrl}/verify`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new DashboardUnavailableError(`Verification returned HTTP ${response.status}.`);
    const result = (await response.json()) as { ok: boolean };
    return { ok: result.ok };
  }

  async getGradeSheet(): Promise<GradeSheet | null> {
    const state = await this.state();
    return this.active(state)?.grade ?? null;
  }

  async getReplayControl(): Promise<ReplayControl> {
    const state = await this.state();
    const latest = this.active(state)?.decisions.at(-1);
    return {
      speeds: [],
      currentSpeed: 1,
      playing: false,
      ...(latest ? { cursorMsgId: latest.triggerMsgId } : {}),
    };
  }

  async getAnchorEvidence(): Promise<readonly AnchorEvidenceRow[]> {
    const state = await this.state();
    return this.active(state)?.anchors ?? [];
  }
}
