import { dashboardData } from "@/lib/data";
import { RadarList } from "@/components/RadarList";

const CLASSES = [
  { id: "late-reaction", body: "Market moved after the event — too slow vs tissue." },
  { id: "fast-reaction", body: "Market moved early; check if information was in the feed." },
  { id: "overreaction", body: "Move size larger than tissue fair-value shift supports." },
  { id: "stale-line", body: "Line lagged after material state change." },
  { id: "draw-compression", body: "Draw implied compressed vs model." },
  { id: "favorite-panic", body: "Favorite price collapsed harder than state justifies." },
  { id: "unexplained-movement", body: "Move with no feed cause → automatic halt. The edge." },
] as const;

export default async function RadarPage() {
  const events = await dashboardData.getRadarEvents();
  return (
    <>
      <section className="panel edge-strip">
        <h2>Signal classes</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Every market reaction is classified against independent tissue price — not LLM intuition.
          Unexplained movement is the only class that forces a full quote halt.
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
