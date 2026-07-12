import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import type { Network } from "@tissue/shared";

/**
 * TxLINE auth chain (Phase 1), faithful to the sponsor scripts
 * (examples/devnet/common/users.ts, documentation/quickstart.mdx):
 *
 *   1. guest JWT     POST {origin}/auth/guest/start                → { token }
 *   2. subscribe     on-chain `subscribe(service_level_id, weeks)` (see subscribe.ts)
 *   3. activate      POST {origin}/api/token/activate
 *                    sign `${txSig}:${leagues.join(",")}:${jwt}` (nacl detached, base64)
 *                    header Authorization: Bearer {jwt}, body { txSig, walletSignature, leagues }
 *   4. stream        headers: Authorization: Bearer {jwt}  +  X-Api-Token: {apiToken}
 *
 * Network-consistency rule (troubleshooting.mdx): JWT host, activation host, RPC, program,
 * and mint must all be the SAME network. We thread `network` through everything.
 */

export interface Origins {
  readonly devnet: string;
  readonly mainnet: string;
}

export function originFor(origins: Origins, network: Network): string {
  return network === "mainnet" ? origins.mainnet : origins.devnet;
}

export interface AuthCredentials {
  readonly network: Network;
  readonly jwt: string;
  readonly apiToken: string;
}

export async function fetchGuestJwt(origin: string): Promise<string> {
  const res = await fetch(`${origin}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new Error(`guest JWT failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("guest JWT response missing token");
  return body.token;
}

/** Sign the activation preimage `${txSig}:${leagues}:${jwt}` and POST /api/token/activate. */
export async function activateToken(
  origin: string,
  jwt: string,
  txSig: string,
  keypair: Keypair,
  leagues: string[] = [],
): Promise<string> {
  const preimage = `${txSig}:${leagues.join(",")}:${jwt}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(preimage), keypair.secretKey);
  const walletSignature = Buffer.from(sig).toString("base64");

  const res = await fetch(`${origin}/api/token/activate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  if (!res.ok) throw new Error(`activate failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { token?: string } | string;
  const token = typeof data === "string" ? data : data.token;
  if (!token) throw new Error("activation response missing token");
  return token;
}

export function authHeaders(creds: AuthCredentials): Record<string, string> {
  return { authorization: `Bearer ${creds.jwt}`, "x-api-token": creds.apiToken };
}
