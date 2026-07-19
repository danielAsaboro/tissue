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
  AblationMatrixSummary,
  ArenaSummary,
  DashboardData,
  AnchorEvidenceRow,
  CommitmentTimelineRow,
  EquityCurvePoint,
  GaugeState,
  HaltState,
  QuoteTapeRow,
  ReplayControl,
  VenueExecutionRow,
  TissueVsMarketSeries,
} from "../types";

interface ApiQuote {
  readonly msgId: string;
  readonly ts: number;
  readonly marketKey: string;
  readonly selection: string;
  readonly side: "BACK" | "LAY";
  readonly quoteMilliOdds: number;
  readonly sizeUnits: number;
  readonly sourceOddsMsgId: string;
  readonly matched: boolean;
}

interface ApiPreMatchCommitment {
  readonly hash: string;
  readonly status: "confirmed" | "failed";
  readonly submittedAt: number;
  readonly txSig?: string;
  readonly error?: string;
}

interface ApiCheckpoint {
  readonly seq: number;
  readonly hash: string;
  readonly status: "confirmed" | "failed";
  readonly submittedAt: number;
  readonly txSig?: string;
  readonly error?: string;
}

interface ApiVenueExecution {
  readonly venue: string;
  readonly decisionSeq: number;
  readonly marketKey: { readonly market: string; readonly lineTimes10?: number };
  readonly selection: string;
  readonly side?: "BACK" | "LAY";
  readonly edgeBps: number;
  readonly tissueProbBps?: number;
  readonly sizeUnits: number;
  readonly status: "confirmed" | "failed" | "rejected-by-gate";
  readonly venueMarketId?: string;
  readonly venuePositionId?: string;
  readonly submissionTxSig?: string;
  readonly submittedAt: number;
  readonly error?: string;
  readonly lifecycleStatus?: "open" | "resolved" | "claimed" | "voided" | "refunded" | "attention-required";
  readonly lifecycleUpdatedAt?: number;
  readonly settlementTxSig?: string;
  readonly claimTxSig?: string;
  readonly voidTxSig?: string;
  readonly refundTxSig?: string;
  readonly lifecycleError?: string;
  readonly venueBreakevenProbBps?: number;
  readonly venueEdgeBps?: number;
  readonly projectedPayoutAtomic?: string;
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
  readonly preMatchCommitment: ApiPreMatchCommitment | null;
  readonly checkpoints: readonly ApiCheckpoint[];
  readonly venueExecutions: readonly ApiVenueExecution[];
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
    const decisionByTriggerMsgId = new Map((fixture?.decisions ?? []).map((d) => [d.triggerMsgId, d]));
    const cluster = state.network === "devnet" ? "?cluster=devnet" : "";
    return (fixture?.quotes ?? []).map((quote) => {
      const anchor = anchors.get(quote.sourceOddsMsgId);
      return {
        tsMs: quote.ts,
        marketLabel: quote.marketKey,
        selectionLabel: quote.selection,
        side: quote.side,
        priceMilliOdds: quote.quoteMilliOdds,
        sizeUnits: quote.sizeUnits,
        status: quote.matched
          ? "Replay matched"
          : anchor?.result
            ? "Published"
            : anchor
              ? "Proof failed"
              : "Pending proof",
        simulated: quote.matched,
        proofMessageId: quote.sourceOddsMsgId,
        ...(decisionByTriggerMsgId.get(quote.msgId)?.hash
          ? { decisionHash: decisionByTriggerMsgId.get(quote.msgId)!.hash }
          : {}),
        ...(anchor?.txSig ? { explorerUrl: `https://explorer.solana.com/tx/${anchor.txSig}${cluster}` } : {}),
      };
    });
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

  async getVenueExecutions(): Promise<readonly VenueExecutionRow[]> {
    const state = await this.state();
    return this.active(state)?.venueExecutions ?? [];
  }

  async getCommitmentTimeline(): Promise<readonly CommitmentTimelineRow[]> {
    const state = await this.state();
    const fixture = this.active(state);
    if (!fixture) return [];
    const rows: CommitmentTimelineRow[] = [];
    if (fixture.preMatchCommitment) {
      const c = fixture.preMatchCommitment;
      rows.push({
        kind: "pre-match",
        submittedAt: c.submittedAt,
        status: c.status,
        hash: c.hash,
        ...(c.txSig ? { txSig: c.txSig } : {}),
        ...(c.error ? { error: c.error } : {}),
      });
    }
    for (const c of fixture.checkpoints) {
      rows.push({
        kind: "checkpoint",
        seq: c.seq,
        submittedAt: c.submittedAt,
        status: c.status,
        hash: c.hash,
        ...(c.txSig ? { txSig: c.txSig } : {}),
        ...(c.error ? { error: c.error } : {}),
      });
    }
    return rows.sort((a, b) => a.submittedAt - b.submittedAt);
  }

  async getArenaSummary(): Promise<ArenaSummary> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/arena`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { available: false, reason: "The Tissue daemon is temporarily unavailable." };
    }
    if (!response.ok && response.status !== 404) {
      return { available: false, reason: `The Tissue daemon returned HTTP ${response.status}.` };
    }
    return (await response.json()) as ArenaSummary;
  }

  async getEquityCurve(): Promise<readonly EquityCurvePoint[]> {
    const state = await this.state();
    const fixture = this.active(state);
    return (fixture?.decisions ?? []).map((record) => ({
      seq: record.seq,
      tsMs: record.ts,
      minute: record.state.minute,
      realizedPnlUnits: record.state.exposure.realizedPnlUnits,
      peakEquityUnits: record.state.exposure.peakEquityUnits,
      drawdownUnits: record.state.exposure.drawdownUnits,
    }));
  }

  async getActiveFixtureId(): Promise<string | null> {
    const state = await this.state();
    return this.active(state)?.fixtureId ?? null;
  }

  async getAblationMatrix(): Promise<AblationMatrixSummary> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/arena/ablation`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { available: false, reason: "The Tissue daemon is temporarily unavailable." };
    }
    if (!response.ok && response.status !== 404) {
      return { available: false, reason: `The Tissue daemon returned HTTP ${response.status}.` };
    }
    return (await response.json()) as AblationMatrixSummary;
  }
}
