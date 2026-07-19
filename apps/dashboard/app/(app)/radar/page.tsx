import { dashboardData } from "@/lib/data";
import { RadarList } from "@/components/RadarList";
import { MatchHeader } from "@/components/MatchHeader";

const CLASSES = [
  { id: "late-reaction", body: "Market moved after the event — too slow vs tissue." },
  { id: "fast-reaction", body: "Market moved early; check if information was in the feed." },
  { id: "overreaction", body: "Move size larger than tissue fair-value shift supports." },
  { id: "stale-line", body: "Line lagged after material state change." },
  { id: "draw-compression", body: "Draw implied compressed vs model." },
  { id: "favorite-panic", body: "Favorite price collapsed harder than state justifies." },
  { id: "unexplained-movement", body: "Move with no feed cause → automatic halt. The edge." },
  {
    id: "informed-flow",
    body: "Move velocity anomalous vs this market's own trailing distribution → automatic halt. Consensus-based (single StablePrice stream), not cross-book — fires even without a fixed magnitude threshold being crossed.",
  },
] as const;

export default async function RadarPage() {
  const [events, meta] = await Promise.all([
    dashboardData.getRadarEvents(),
    dashboardData.getActiveFixtureMeta(),
  ]);
  return (
    <>
      <MatchHeader meta={meta} />
      <section className="panel edge-strip">
        <h2>Signal classes</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Each supported-market reaction is classified against independent tissue price — not LLM intuition.
          Unexplained-movement and informed-flow are the two classes that force a market halt
          (adverse selection); every other class only conditions spread/size.
        </p>
        <ul className="edge-list">
          {CLASSES.map((c) => (
            <li key={c.id}>
              <strong>{c.id}</strong> — {c.body}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Latency radar</h2>
        <RadarList events={events} />
      </section>
    </>
  );
}
