import { dashboardData } from "@/lib/data";
import { HaltBanner } from "@/components/HaltBanner";
import { TissueVsMarketChart } from "@/components/TissueVsMarketChart";
import { Gauges } from "@/components/Gauges";
import Link from "next/link";

export default async function OverviewPage() {
  const [halt, series, gauges] = await Promise.all([
    dashboardData.getHalt(),
    dashboardData.getTissueVsMarket(),
    dashboardData.getGauges(),
  ]);

  return (
    <div>
      <HaltBanner halt={halt} />

      {/* Judge / competitor edge: deterministic desk, not LLM vibes */}
      <section className="panel edge-strip">
        <h2>Proof surface</h2>
        <ul className="edge-list">
          <li>
            <strong>Independent price</strong> — Poisson + Dixon–Coles from verified match state, not
            a copy of the last odds tick.
          </li>
          <li>
            <strong>Latency Radar</strong> — every market reaction classified against tissue fair
            value (late / fast / overreact / stale / unexplained).
          </li>
          <li>
            <strong>Halt discipline</strong> — unexplained movement pulls quotes. No trade against
            unseen information.
          </li>
          <li>
            <strong>replay(corpus) === ledger</strong> — hash-chained decisions, asserted in CI.{" "}
            <Link href="/grade">Open grade sheet →</Link>
          </li>
          <li>
            <strong>No fake fills</strong> — live mode publishes risk-approved quotes only. CLV grades
            every quote without inventing counterparties.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>
          Tissue vs market · {series.marketLabel} · {series.selectionLabel}
        </h2>
        <TissueVsMarketChart series={series} />
      </section>

      <section className="panel">
        <h2>Published quote exposure</h2>
        <p className="muted">
          Intent exposure only. Live mode does not claim counterparty fills or realized PnL.
        </p>
        <Gauges gauges={gauges} />
      </section>
    </div>
  );
}
