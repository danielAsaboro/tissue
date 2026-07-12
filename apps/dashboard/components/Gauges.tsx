import type { GaugeState } from "@/lib/data/types";
import { formatUnits } from "@/lib/format";
import { SimBadge } from "./SimBadge";

export function Gauges({ gauges }: { gauges: GaugeState }) {
  const { inventory, exposure } = gauges;
  return (
    <div>
      <div className="grid-2">
        <div className="metric">
          <span className="label">Net inventory</span>
          <span className="value">{formatUnits(inventory.netUnits)}</span>
        </div>
        <div className="metric">
          <span className="label">Fixture exposure</span>
          <span className="value">{formatUnits(exposure.perFixtureUnits)}</span>
        </div>
        <div className="metric">
          <span className="label">Open intents</span>
          <span className="value">{exposure.openIntents}</span>
        </div>
        <div className="metric">
          <span className="label">
            Realized PnL <SimBadge />
          </span>
          <span className="value">{formatUnits(exposure.realizedPnlUnits)}</span>
        </div>
        <div className="metric">
          <span className="label">Peak equity</span>
          <span className="value">{formatUnits(exposure.peakEquityUnits)}</span>
        </div>
        <div className="metric">
          <span className="label">Drawdown</span>
          <span className="value">{formatUnits(exposure.drawdownUnits)}</span>
        </div>
      </div>

      <table style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Selection</th>
            <th className="num">Inventory (units)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(inventory.bySelection).map(([selection, value]) => (
            <tr key={selection}>
              <td>{selection}</td>
              <td className="num">{formatUnits(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Market</th>
            <th className="num">Exposure (units)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(exposure.perMarketUnits).map(([market, value]) => (
            <tr key={market}>
              <td>{market}</td>
              <td className="num">{formatUnits(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
