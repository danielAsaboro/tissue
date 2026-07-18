import { dashboardData } from "@/lib/data";
import { VerifyPanel } from "@/components/VerifyPanel";
import { formatClock } from "@/lib/format";

export default async function VerifyPage() {
  const [fixtureId, decisions] = await Promise.all([
    dashboardData.getActiveFixtureId(),
    dashboardData.getDecisionFeed(),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 16, letterSpacing: "0.06em", marginBottom: 4 }}>
        Verify a decision yourself
      </h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        You need nothing from Tissue but a browser and a public Solana RPC. Nothing on this
        page is taken on trust.
      </p>

      <section className="panel">
        <h2>How this works</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick any decision below and press <strong>Verify independently</strong>. Every
          step after the first runs entirely in your own browser:
        </p>
        <ol style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li>Fetch the public record export (<code>/api/desk/record</code>, a same-origin
            proxy of the daemon&apos;s <code>/record</code> — data assembly only, not the
            trust-sensitive step).</li>
          <li>Recompute the decision&apos;s hash with WebCrypto, in your browser — never
            Tissue&apos;s server.</li>
          <li>Ed25519-verify the record&apos;s signature against the operator&apos;s public
            key, if one is present.</li>
          <li>Fetch the Merkle inclusion proof and walk it locally to confirm the decision
            is included under a specific anchored root.</li>
          <li>Fetch the anchoring transaction <strong>directly from a public Solana RPC</strong> —
            this is the decisive step, and Tissue&apos;s own server is never involved in it.</li>
          <li>Recompute the commitment hash and confirm it matches the real bytes of the
            on-chain memo.</li>
        </ol>
        <p className="muted" style={{ marginTop: 0 }}>
          A compromised or dishonest daemon cannot pass this check by simply returning{" "}
          <code>{"{ ok: true }"}</code> — every step is independently recomputable, and the
          final comparison happens against transaction bytes fetched outside Tissue&apos;s
          control. See <code>architecture.md</code> §5 in the repository for the full
          specification, or fetch the raw export yourself at{" "}
          <a href="/api/desk/record" target="_blank" rel="noreferrer">/api/desk/record</a>.
        </p>
      </section>

      <section className="panel">
        <h2>Decisions{fixtureId ? ` — ${fixtureId}` : ""}</h2>
        {decisions.length === 0 ? (
          <p className="empty">No decisions yet — there is nothing to verify until the desk has real data.</p>
        ) : !fixtureId ? (
          <p className="empty">No active fixture.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">Seq</th>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Hash</th>
                  <th>Signed</th>
                  <th>Verify</th>
                </tr>
              </thead>
              <tbody>
                {decisions.slice(-25).reverse().map((record) => (
                  <tr key={record.seq}>
                    <td className="num">{record.seq}</td>
                    <td>{formatClock(record.ts)}</td>
                    <td>{record.action}</td>
                    <td className="muted">{record.hash.slice(0, 10)}…</td>
                    <td>{record.signature ? <span className="badge">ED25519</span> : <span className="muted">·</span>}</td>
                    <td><VerifyPanel fixtureId={fixtureId} seq={record.seq} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
