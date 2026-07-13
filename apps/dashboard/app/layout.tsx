import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

// OpenRunde is the design typeface; Inter is its named fallback (design.md). next/font
// self-hosts it, so there is no runtime external request.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tissue: prices the game",
  description:
    "An in-play trading desk that builds its own price from the match, quotes when the market disagrees, halts on movement it cannot explain, and grades itself in public.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
