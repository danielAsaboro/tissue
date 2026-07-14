import { address } from "@solana/kit";
import type { SlipClientConfig } from "@slip/sdk";

export interface TissueSlipConfig extends SlipClientConfig {
  readonly watchedWallet?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function absoluteUrl(name: string, value: string, protocols: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Slip is opt-in for Tissue. No variables means disabled; a partial configuration is a
 * fatal configuration error rather than an implicit cluster, mint, or program fallback.
 */
export function loadTissueSlipConfig(env: Environment = process.env): TissueSlipConfig | null {
  const keys = [
    "TISSUE_SLIP_RPC_URL",
    "TISSUE_SLIP_PROGRAM_ID",
    "TISSUE_SLIP_SETTLEMENT_MINT",
    "TISSUE_SLIP_WEBSOCKET_URL",
    "TISSUE_SLIP_COMPILER_ORIGIN",
    "TISSUE_SLIP_WALLET",
  ] as const;
  if (!keys.some((key) => Boolean(env[key]?.trim()))) return null;

  const rpc = env.TISSUE_SLIP_RPC_URL?.trim();
  const program = env.TISSUE_SLIP_PROGRAM_ID?.trim();
  const mint = env.TISSUE_SLIP_SETTLEMENT_MINT?.trim();
  if (!rpc || !program || !mint) {
    throw new Error(
      "Tissue Slip integration requires TISSUE_SLIP_RPC_URL, TISSUE_SLIP_PROGRAM_ID, and TISSUE_SLIP_SETTLEMENT_MINT together",
    );
  }
  const tissueNetwork = env.TISSUE_NETWORK ?? "devnet";
  if (tissueNetwork !== "devnet" && tissueNetwork !== "mainnet") {
    throw new Error(`TISSUE_NETWORK must be devnet or mainnet; received ${JSON.stringify(tissueNetwork)}`);
  }
  const websocketUrl = env.TISSUE_SLIP_WEBSOCKET_URL?.trim();
  const compilerOrigin = env.TISSUE_SLIP_COMPILER_ORIGIN?.trim();
  const watchedWallet = env.TISSUE_SLIP_WALLET?.trim();
  return {
    network: tissueNetwork === "mainnet" ? "mainnet-beta" : "devnet",
    rpcUrl: absoluteUrl("TISSUE_SLIP_RPC_URL", rpc, ["http:", "https:"]),
    programAddress: address(program),
    settlementMint: address(mint),
    commitment: "confirmed",
    ...(websocketUrl
      ? { websocketUrl: absoluteUrl("TISSUE_SLIP_WEBSOCKET_URL", websocketUrl, ["ws:", "wss:"]) }
      : {}),
    ...(compilerOrigin
      ? { compilerOrigin: absoluteUrl("TISSUE_SLIP_COMPILER_ORIGIN", compilerOrigin, ["http:", "https:"]) }
      : {}),
    ...(watchedWallet ? { watchedWallet: address(watchedWallet) } : {}),
  };
}
