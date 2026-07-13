import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { dashboardData } from "@/lib/data";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

function networkLabel(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Nav />
      <div className="live-row"><LiveRefresh /></div>
      <main>{children}</main>
      <footer className="footer">
        <span>
          {networkLabel(dashboardData.network)} · live TxLINE input · quote publication. No
          counterparty fills or PnL are invented.
        </span>
        <Link href="/" className="footer-home">
          Back to home
        </Link>
      </footer>
    </div>
  );
}
