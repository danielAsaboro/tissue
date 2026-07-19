import { dashboardData } from "@/lib/data";
import { DecisionFeed } from "@/components/DecisionFeed";
import { MatchHeader } from "@/components/MatchHeader";
import { VerifyHashChainButton } from "./VerifyHashChainButton";
import { AnchorEvidenceList } from "@/components/AnchorEvidenceList";
import { CommitmentTimeline } from "@/components/CommitmentTimeline";
import { VenueExecutionList } from "@/components/SlipExecutionList";

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ fixtureId?: string }>;
}) {
  const { fixtureId } = await searchParams;
  const [records, meta] = await Promise.all([
    dashboardData.getDecisionFeed(fixtureId),
    dashboardData.getActiveFixtureMeta(fixtureId),
  ]);
  // Anchors/commitments/venue executions are live-desk-only artifacts (no on-chain proof was
  // ever submitted for a pure backtest fixture) and today's data layer only exposes them for
  // whichever fixture is actually live — so they'd be misleading if shown for a specific
  // archived match picked from the history list. Real, not hidden: an archived match simply
  // never had these to begin with.
  const [anchors, commitments, venueExecutions] = fixtureId
    ? [[], [], []]
    : await Promise.all([
      dashboardData.getAnchorEvidence(),
      dashboardData.getCommitmentTimeline(),
      dashboardData.getVenueExecutions(),
    ]);
  return (
    <div>
      <MatchHeader {...(fixtureId ? { fixtureId } : {})} meta={meta} />
      <section className="panel">
        <h2>Decision feed</h2>
        {records.length > 0 ? (
          <div style={{ marginBottom: 16 }}><VerifyHashChainButton /></div>
        ) : (
          <p className="empty">Waiting for the first real decision. There is no hash chain to verify yet.</p>
        )}
        <DecisionFeed records={records} />
      </section>
      <section className="panel">
        <h2>TxLINE input verification</h2>
        <AnchorEvidenceList rows={anchors} network={dashboardData.network} />
      </section>
      <section className="panel">
        <h2>On-chain commitment timeline</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Real SPL Memo transactions anchoring the ledger's hash — a pre-kickoff snapshot
          proving the model was committed before any score message, plus periodic checkpoints
          of the head hash through the match (each folds in everything decided so far).
        </p>
        <CommitmentTimeline rows={commitments} network={dashboardData.network} />
      </section>
      <section className="panel">
        <h2>Real venue execution</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Slip is the only enabled adapter today. Every row must pass adapter discovery,
          liquidity economics, capital policy, signing, confirmation, and reconciliation.
        </p>
        <VenueExecutionList rows={venueExecutions} network={dashboardData.network} />
      </section>
    </div>
  );
}
