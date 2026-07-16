import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://usetissue.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Tissue · prices the game",
    template: "%s · Tissue",
  },
  description:
    "An in-play trading desk that builds its own price from verified match state, quotes when the market disagrees, halts on movement it cannot explain, and grades itself from a hash-chained ledger.",
  applicationName: "Tissue",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Tissue",
    title: "Tissue · an independent price for every live match market",
    description:
      "TxLINE scores + odds in. Fair value out. Latency Radar classifies reactions. Halt on unexplained movement. Hash-chained, replayable.",
    images: [
      {
        url: "/images/og.jpg",
        width: 1200,
        height: 630,
        alt: "Tissue — independent in-play fair value desk",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tissue · an independent price for every live match market",
    description:
      "TxLINE scores + odds in. Fair value out. Latency Radar classifies reactions. Halt on unexplained movement.",
    images: ["/images/og.jpg"],
    site: "@usetissue_",
  },
  icons: { icon: "/images/og.jpg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
