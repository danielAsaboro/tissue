import { dashboardData } from "@/lib/data";
import { HaltBanner } from "@/components/HaltBanner";
import { TissueVsMarketChart } from "@/components/TissueVsMarketChart";
import { Gauges } from "@/components/Gauges";

export default async function OverviewPage() {
  const [halt, series, gauges] = await Promise.all([
    dashboardData.getHalt(),
    dashboardData.getTissueVsMarket(),
    dashboardData.getGauges(),
  ]);

  return (
    <div>
      <HaltBanner halt={halt} />

      <section className="panel">
        <h2>
          Tissue vs market · {series.marketLabel} · {series.selectionLabel}
        </h2>
        <TissueVsMarketChart series={series} />
      </section>

      <section className="panel">
        <h2>Published quote exposure</h2>
        <p className="muted">Intent exposure only. Live mode does not claim counterparty fills or realized PnL.</p>
        <Gauges gauges={gauges} />
      </section>
    </div>
  );
}
