import type { ScoreMessage } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { evaluateSlipExecution } from "../risk/gates.js";
import {
  calculateSlipBuyQuote,
  discoverSlipMarket,
  executeSlipBuy,
  reconcileSlipExecution,
  stakeUnitsToAmount,
  type SlipExecOptions,
  type SlipExecutionEvidence,
  type SlipLifecycleOptions,
} from "./slipExec.js";
import type {
  VenueAdapter,
  VenueAuthorizationDecision,
  VenueExecutionEvidence,
  VenueExecutionRequest,
  VenueExposureContext,
  VenueFairValueComparison,
  VenueMarketDiscovery,
  VenueTradeCandidate,
} from "./venue.js";

export interface SlipVenueOptions extends SlipExecOptions {
  readonly policy: Policy;
  readonly lifecycleOptions: () => SlipLifecycleOptions;
}

/** Slip is Tissue's first and currently only real venue adapter. No other adapter is
 * registered until it has equivalent discovery, signing, reconciliation, and evidence. */
export class SlipVenueAdapter implements VenueAdapter {
  readonly id = "slip";

  constructor(private readonly options: SlipVenueOptions) {}

  supportsMarket(candidate: VenueTradeCandidate): boolean {
    return candidate.marketKey.market === "1X2" || candidate.marketKey.market === "TOTALS";
  }

  authorize(
    candidates: readonly VenueTradeCandidate[],
    exposure: VenueExposureContext,
  ): VenueAuthorizationDecision {
    const supported: VenueTradeCandidate[] = [];
    const rejected: { candidate: VenueTradeCandidate; reason: string }[] = [];
    for (const candidate of candidates) {
      if (this.supportsMarket(candidate)) supported.push(candidate);
      else rejected.push({ candidate, reason: "market-family-not-supported-by-slip-adapter" });
    }
    const slipDecision = evaluateSlipExecution(supported, exposure, this.options.policy);
    return { approved: slipDecision.approved, rejected: [...rejected, ...slipDecision.rejected] };
  }

  async discover(request: VenueExecutionRequest): Promise<VenueMarketDiscovery> {
    const discovery = await discoverSlipMarket(request.candidate, request.fixtureId, this.options);
    return {
      venue: this.id,
      identity: discovery.market.address,
      fixtureId: request.fixtureId,
      marketKey: request.candidate.marketKey,
      outcomeId: String(discovery.outcomeIndex),
      outcomeIndex: discovery.outcomeIndex,
      liquidity: discovery.market.outcomes.map((outcome) => ({
        outcomeId: String(outcome.index),
        amountAtomic: outcome.poolAtomic,
      })),
      feeBps: discovery.market.feeBps,
      tipBps: discovery.market.tipBps,
      discoveredAt: Date.now(),
    };
  }

  compare(
    request: VenueExecutionRequest,
    discovery: VenueMarketDiscovery,
  ): VenueFairValueComparison {
    this.assertDiscovery(request, discovery);
    const quote = calculateSlipBuyQuote({
      feeBps: discovery.feeBps,
      tipBps: discovery.tipBps,
      outcomes: discovery.liquidity.map((outcome, index) => ({
        index,
        label: outcome.outcomeId,
        pool: outcome.amountAtomic,
        poolAtomic: outcome.amountAtomic,
        probabilityBps: 0,
        projectedPayout: null,
      })),
    }, discovery.outcomeIndex, stakeUnitsToAmount(request.candidate.sizeUnits), request.candidate.tissueProbBps);
    const clearsVenueEconomics = quote.venueEdgeBps >= this.options.minVenueEdgeBps;
    return {
      fairProbabilityBps: request.candidate.tissueProbBps,
      breakevenProbabilityBps: quote.breakevenProbBps,
      venueEdgeBps: quote.venueEdgeBps,
      projectedPayoutAtomic: quote.projectedPayoutAtomic.toString(),
      clearsVenueEconomics,
      ...(clearsVenueEconomics ? {} : {
        rejectionReason: `Slip post-stake venue edge ${quote.venueEdgeBps}bps is below required ${this.options.minVenueEdgeBps}bps`,
      }),
    };
  }

  async submit(
    request: VenueExecutionRequest,
    discovery: VenueMarketDiscovery,
    comparison: VenueFairValueComparison,
  ): Promise<SlipExecutionEvidence> {
    this.assertDiscovery(request, discovery);
    if (!comparison.clearsVenueEconomics) throw new Error("Slip submission received a rejected venue comparison");
    // executeSlipBuy re-discovers and revalidates canonical account state immediately before
    // signing, so discovery cannot become an unchecked TOCTOU authorization.
    return executeSlipBuy(
      request.candidate,
      request.fixtureId,
      request.decisionSeq,
      request.nonce,
      this.options,
    );
  }

  reconcile(
    evidence: VenueExecutionEvidence,
    terminalScore: ScoreMessage | undefined,
  ): Promise<SlipExecutionEvidence> {
    if (evidence.venue !== this.id) throw new Error(`Slip adapter cannot reconcile ${evidence.venue} evidence`);
    return reconcileSlipExecution(evidence as SlipExecutionEvidence, terminalScore, this.options.lifecycleOptions());
  }

  private assertDiscovery(request: VenueExecutionRequest, discovery: VenueMarketDiscovery): void {
    if (discovery.venue !== this.id || discovery.fixtureId !== request.fixtureId) {
      throw new Error("Slip discovery identity does not match the execution request");
    }
    if (
      discovery.marketKey.market !== request.candidate.marketKey.market
      || discovery.marketKey.lineTimes10 !== request.candidate.marketKey.lineTimes10
    ) {
      throw new Error("Slip discovery market key does not match the execution request");
    }
  }
}
