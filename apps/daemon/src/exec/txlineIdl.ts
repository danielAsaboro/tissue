import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Network } from "@tissue/shared";
import { PROGRAM_ID } from "./anchor.js";

const cwdIdlPath = resolve(process.cwd(), "apps/daemon/idls/txoracle.json");
const IDL_PATH = process.env.TISSUE_IDL_PATH
  ?? (existsSync(cwdIdlPath) ? cwdIdlPath : fileURLToPath(new URL("../../idls/txoracle.json", import.meta.url)));

/** TxLINE 1.5.6 deploys the same instruction schema at different devnet/mainnet addresses.
 * Anchor takes the program address from the IDL, so bind the verified schema explicitly to
 * the selected network instead of accidentally rejecting mainnet with the devnet address. */
export function loadTxlineIdl(network: Network): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(IDL_PATH, "utf8")) as Record<string, unknown>;
  return { ...parsed, address: PROGRAM_ID[network].toBase58() };
}
