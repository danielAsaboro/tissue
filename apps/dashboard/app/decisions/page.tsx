import { dashboardData } from "@/lib/data";
import { DecisionFeed } from "@/components/DecisionFeed";
import { VerifyHashChainButton } from "./VerifyHashChainButton";

export default async function DecisionsPage() {
  const records = await dashboardData.getDecisionFeed();
  return (
    <section className="panel">
      <h2>Decision feed</h2>
      <div style={{ marginBottom: 16 }}>
        <VerifyHashChainButton />
      </div>
      <DecisionFeed records={records} />
    </section>
  );
}
