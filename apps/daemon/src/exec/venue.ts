import type { MarketKey, ScoreMessage, Selection } from "@tissue/shared";

/** A Tissue intent that already cleared the desk's quote-publication risk gate. */
export interface VenueTradeCandidate {
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side: "BACK" | "LAY";
  readonly sizeUnits: number;
  readonly edgeBps: number;
  readonly tissueProbBps: number;
}

export interface VenueExposureContext {
  readonly stakedByMarketUnits: Readonly<Record<string, number>>;
  readonly totalStakedUnits: number;
}

export interface VenueAuthorizationDecision {
  readonly approved: readonly VenueTradeCandidate[];
  readonly rejected: readonly { candidate: VenueTradeCandidate; reason: string }[];
}

/** Canonical, venue-neutral result of market discovery. Adapter-private account objects never
 * escape this boundary; submission must revalidate the identified market before signing. */
export interface VenueMarketDiscovery {
  readonly venue: string;
  readonly identity: string;
  readonly fixtureId: string;
  readonly marketKey: MarketKey;
  readonly outcomeId: string;
  readonly outcomeIndex: number;
  readonly liquidity: readonly { outcomeId: string; amountAtomic: string }[];
  readonly feeBps: number;
  readonly tipBps: number;
  readonly discoveredAt: number;
}

export interface VenueFairValueComparison {
  readonly fairProbabilityBps: number;
  readonly breakevenProbabilityBps: number;
  readonly venueEdgeBps: number;
  readonly projectedPayoutAtomic: string;
  readonly clearsVenueEconomics: boolean;
  readonly rejectionReason?: string;
}

export type VenueExecutionStatus = "confirmed" | "failed" | "rejected-by-gate";

/** Durable execution evidence shared by every real venue adapter. Venue-specific identifiers
 * are explicit strings, never fabricated fills; transaction signatures exist only after the
 * adapter observes confirmation. */
export interface VenueExecutionEvidence {
  readonly venue: string;
  readonly fixtureId: string;
  readonly decisionSeq: number;
  readonly marketKey: MarketKey;
  readonly selection: Selection;
  readonly side?: "BACK" | "LAY";
  readonly edgeBps: number;
  readonly tissueProbBps?: number;
  readonly sizeUnits: number;
  readonly outcomeIndex: number;
  readonly stakeAmount: string;
  readonly status: VenueExecutionStatus;
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

export interface VenueExecutionRequest {
  readonly fixtureId: string;
  readonly decisionSeq: number;
  readonly nonce: bigint;
  readonly candidate: VenueTradeCandidate;
}

export interface VenueAdapter {
  readonly id: string;
  supportsMarket(candidate: VenueTradeCandidate): boolean;
  authorize(candidates: readonly VenueTradeCandidate[], exposure: VenueExposureContext): VenueAuthorizationDecision;
  discover(request: VenueExecutionRequest): Promise<VenueMarketDiscovery>;
  compare(request: VenueExecutionRequest, discovery: VenueMarketDiscovery): VenueFairValueComparison;
  submit(
    request: VenueExecutionRequest,
    discovery: VenueMarketDiscovery,
    comparison: VenueFairValueComparison,
  ): Promise<VenueExecutionEvidence>;
  reconcile(evidence: VenueExecutionEvidence, terminalScore: ScoreMessage | undefined): Promise<VenueExecutionEvidence>;
}

/** Shared orchestration makes every enabled adapter pass through the same observable stages. */
export async function executeThroughVenue(
  adapter: VenueAdapter,
  request: VenueExecutionRequest,
): Promise<VenueExecutionEvidence> {
  const discovery = await adapter.discover(request);
  const comparison = adapter.compare(request, discovery);
  if (!comparison.clearsVenueEconomics) {
    return {
      ...failedVenueEvidence(adapter.id, request, comparison.rejectionReason ?? "venue-economics-rejected"),
      venueMarketId: discovery.identity,
      venueBreakevenProbBps: comparison.breakevenProbabilityBps,
      venueEdgeBps: comparison.venueEdgeBps,
      projectedPayoutAtomic: comparison.projectedPayoutAtomic,
    };
  }
  return adapter.submit(request, discovery, comparison);
}

export function failedVenueEvidence(
  venue: string,
  request: VenueExecutionRequest,
  error: string,
  submittedAt = Date.now(),
): VenueExecutionEvidence {
  return {
    venue,
    fixtureId: request.fixtureId,
    decisionSeq: request.decisionSeq,
    marketKey: request.candidate.marketKey,
    selection: request.candidate.selection,
    side: request.candidate.side,
    edgeBps: request.candidate.edgeBps,
    tissueProbBps: request.candidate.tissueProbBps,
    sizeUnits: request.candidate.sizeUnits,
    outcomeIndex: -1,
    stakeAmount: "0",
    status: "failed",
    submittedAt,
    error,
  };
}
