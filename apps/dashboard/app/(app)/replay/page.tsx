import { dashboardData } from "@/lib/data";

export default async function ReplayPage() {
  const records = await dashboardData.getDecisionFeed();
  const latest = records.at(-1);
  return (
    <section className="panel">
      <h2>Recorded evidence</h2>
      <p className="muted">
        The live desk persists every TxLINE message and hash-chained decision. Deterministic
        playback runs from the CLI so this deployed surface never pretends local controls
        changed the engine.
      </p>
      {latest ? (
        <dl className="evidence-list">
          <div><dt>Latest message</dt><dd>{latest.triggerMsgId}</dd></div>
          <div><dt>Decision sequence</dt><dd>{latest.seq}</dd></div>
          <div><dt>Head hash</dt><dd className="mono">{latest.hash}</dd></div>
        </dl>
      ) : (
        <p className="empty">Waiting for the first real TxLINE message. Nothing synthetic is shown.</p>
      )}
    </section>
  );
}
