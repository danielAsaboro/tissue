import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Network } from "@tissue/shared";
import type { AuthCredentials } from "../ingest/txlineAuth.js";

export interface LiveConfig {
  readonly mode: "live";
  readonly network: Network;
  readonly origin: string;
  readonly port: number;
  readonly credentialsPath?: string;
  readonly allowedOrigins: readonly string[];
  readonly rpcUrl: string;
  readonly anchorMode: "view" | "transaction";
  readonly keypairPath?: string;
  readonly databaseUrl: string;
}

function requiredUrl(name: string, fallback: string): string {
  const raw = process.env[name] ?? fallback;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL; received ${JSON.stringify(raw)}`);
  }
}

export function loadLiveConfig(): LiveConfig {
  const mode = process.env.TISSUE_MODE;
  if (mode !== "live") {
    throw new Error(
      "TISSUE_MODE=live is required for the daemon. Use `pnpm run replay` for recorded data; the daemon never falls back to replay or synthetic input.",
    );
  }
  const networkRaw = process.env.TISSUE_NETWORK ?? "devnet";
  if (networkRaw !== "devnet" && networkRaw !== "mainnet") {
    throw new Error(`TISSUE_NETWORK must be devnet or mainnet; received ${JSON.stringify(networkRaw)}`);
  }
  const network: Network = networkRaw;
  const origin = requiredUrl(
    network === "devnet" ? "TXLINE_DEVNET_ORIGIN" : "TXLINE_MAINNET_ORIGIN",
    network === "devnet" ? "https://txline-dev.txodds.com" : "https://txline.txodds.com",
  );
  const port = Number(process.env.TISSUE_API_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`TISSUE_API_PORT must be an integer from 1 to 65535; received ${JSON.stringify(process.env.TISSUE_API_PORT)}`);
  }
  const credentialsPath = process.env.TXLINE_CREDENTIALS_PATH
    ? resolve(process.env.TXLINE_CREDENTIALS_PATH)
    : resolve("apps/daemon/.keys/apitoken.json");
  const allowedOrigins = (process.env.TISSUE_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const rpcUrl = requiredUrl(
    network === "devnet" ? "SOLANA_RPC_DEVNET" : "SOLANA_RPC_MAINNET",
    network === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com",
  );
  const anchorModeRaw = process.env.TISSUE_ANCHOR_MODE ?? "view";
  if (anchorModeRaw !== "view" && anchorModeRaw !== "transaction") {
    throw new Error(`TISSUE_ANCHOR_MODE must be view or transaction; received ${JSON.stringify(anchorModeRaw)}`);
  }
  const keypairPath = process.env.TISSUE_KEYPAIR_PATH;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for the daemon (Postgres-backed decision ledger, corpus, and proof evidence).",
    );
  }
  return {
    mode: "live",
    network,
    origin,
    port,
    credentialsPath,
    allowedOrigins,
    rpcUrl,
    anchorMode: anchorModeRaw,
    ...(keypairPath ? { keypairPath } : {}),
    databaseUrl,
  };
}

export function loadCredentials(config: LiveConfig): AuthCredentials {
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (jwt || apiToken) {
    if (!jwt || !apiToken) {
      throw new Error("TXLINE_JWT and TXLINE_API_TOKEN must be provided together");
    }
    return { network: config.network, jwt, apiToken };
  }
  if (!config.credentialsPath || !existsSync(config.credentialsPath)) {
    throw new Error(
      `TxLINE credentials unavailable. Set TXLINE_JWT + TXLINE_API_TOKEN or create ${config.credentialsPath ?? "a credentials file"} with the live activation command.`,
    );
  }
  if (process.platform !== "win32") {
    const mode = statSync(config.credentialsPath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `TxLINE credentials at ${config.credentialsPath} are accessible by group/other (mode ${mode.toString(8)}); require chmod 600`,
      );
    }
  }
  const parsed = JSON.parse(readFileSync(config.credentialsPath, "utf8")) as Partial<AuthCredentials>;
  if (parsed.network !== config.network || !parsed.jwt || !parsed.apiToken) {
    throw new Error(
      `TxLINE credentials at ${config.credentialsPath} must contain network=${config.network}, jwt, and apiToken`,
    );
  }
  return { network: config.network, jwt: parsed.jwt, apiToken: parsed.apiToken };
}
