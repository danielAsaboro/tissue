import { dashboardData } from "@/lib/data";
import { DecisionFeed } from "@/components/DecisionFeed";
import { VerifyHashChainButton } from "./VerifyHashChainButton";
import { AnchorEvidenceList } from "@/components/AnchorEvidenceList";

export default async function DecisionsPage() {
  const [records, anchors] = await Promise.all([
    dashboardData.getDecisionFeed(),
    dashboardData.getAnchorEvidence(),
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
    </div>
  );
}
