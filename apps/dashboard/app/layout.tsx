import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { dashboardData } from "@/lib/data";
import "./globals.css";

export const metadata: Metadata = {
  title: "TISSUE — Trading Desk",
  description: "In-play trading desk cockpit. Devnet, simulated maker book.",
};

function networkLabel(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Nav />
          <main>{children}</main>
          <footer className="footer">
            {networkLabel(dashboardData.network)} · simulated maker book — fills
            shown here run through the internal simulated book, never a real
            counterparty.
          </footer>
        </div>
      </body>
    </html>
  );
}
