import { dashboardData } from "@/lib/data";
import { ReplayControls } from "./ReplayControls";

export default async function ReplayPage() {
  const control = await dashboardData.getReplayControl();
  return (
    <section className="panel">
      <h2>Replay control</h2>
      <ReplayControls control={control} />
    </section>
  );
}
