import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { dashboardData } from "@/lib/data";

function networkLabel(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Nav />
      <main>{children}</main>
      <footer className="footer">
        <span>
          {networkLabel(dashboardData.network)} · simulated maker book. Fills shown here run
          through the internal simulated book, never a real counterparty.
        </span>
        <Link href="/" className="footer-home">
          Back to home
        </Link>
      </footer>
    </div>
  );
}
