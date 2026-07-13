import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tissue: prices the game",
  description:
    "An in-play trading desk that builds its own price from verified match state, quotes when the market disagrees, halts on movement it cannot explain, and grades itself from a hash-chained ledger.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
