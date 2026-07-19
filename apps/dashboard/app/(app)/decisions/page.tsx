import { dashboardData } from "@/lib/data";
import { DecisionFeed } from "@/components/DecisionFeed";
import { VerifyHashChainButton } from "./VerifyHashChainButton";
import { AnchorEvidenceList } from "@/components/AnchorEvidenceList";
import { CommitmentTimeline } from "@/components/CommitmentTimeline";
import { SlipExecutionList } from "@/components/SlipExecutionList";

export default async function DecisionsPage() {
  const [records, anchors, commitments, slipExecutions] = await Promise.all([
    dashboardData.getDecisionFeed(),
    dashboardData.getAnchorEvidence(),
    dashboardData.getCommitmentTimeline(),
    dashboardData.getSlipExecutions(),
  ]);
  return (
    <div>
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
        <h2>Real execution on Slip</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          TxLINE has no order/execution instructions of its own — this is where a decision
          actually lands as a signed, confirmed transaction on a real settlement venue.
        </p>
        <SlipExecutionList rows={slipExecutions} network={dashboardData.network} />
      </section>
    </div>
  );
}
