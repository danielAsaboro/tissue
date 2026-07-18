import type { NextConfig } from "next";

// The in-browser verifier (components/VerifyPanel.tsx) fetches an anchoring transaction
// directly from a public Solana RPC, from the visitor's own browser — the whole point being
// that Tissue's own server is never in the trust path for that specific check. That needs
// exactly this one extra connect-src origin, nothing broader. This value ships in the
// browser bundle, so it must never carry an API key.
const PUBLIC_SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const nextConfig: NextConfig = {
  transpilePackages: ["@tissue/shared"],
  poweredByHeader: false,
  output: "standalone",
  env: {
    NEXT_PUBLIC_SOLANA_RPC_URL: PUBLIC_SOLANA_RPC_URL,
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${PUBLIC_SOLANA_RPC_URL}`,
        },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
