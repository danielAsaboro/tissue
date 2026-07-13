import { dashboardData } from "@/lib/data";
import { RadarList } from "@/components/RadarList";

export default async function RadarPage() {
  const events = await dashboardData.getRadarEvents();
  return (
    <section className="panel">
      <h2>Latency radar</h2>
      <RadarList events={events} />
    </section>
  );
}
