import type { Network } from "@tissue/shared";
import type { AuthCredentials } from "./txlineAuth.js";

/**
 * Pricing-source resolution with a clean mainnet→devnet fallback (PRD §4 network split, V2).
 *
 * Pricing inputs MAY use mainnet realtime (level 12), but that activation needs real SOL and
 * can be rejected. If it is, the desk must fall back to devnet-only pricing cleanly and say
 * so loudly — never block, never pretend it went to mainnet. Execution/anchoring stay devnet
 * regardless. The activator is injected so this is testable without a live network or wallet.
 */

export interface PricingActivator {
  /** Full auth chain (guest JWT → subscribe → activate) for the given network. Throws on failure. */
  activate(network: Network): Promise<AuthCredentials>;
}

export interface PricingSource {
  readonly network: Network;
  readonly creds: AuthCredentials;
  /** True when mainnet was attempted and we fell back to devnet. */
  readonly fellBack: boolean;
  readonly reason?: string;
}

export async function resolvePricingSource(
  activator: PricingActivator,
  opts: { attemptMainnet: boolean },
): Promise<PricingSource> {
  if (!opts.attemptMainnet) {
    return { network: "devnet", creds: await activator.activate("devnet"), fellBack: false };
  }
  try {
    const creds = await activator.activate("mainnet");
    return { network: "mainnet", creds, fellBack: false };
  } catch (err) {
    const reason = `mainnet activation rejected (${(err as Error).message}); using devnet-only pricing`;
    // Devnet must succeed — if it also fails, fail LOUDLY (no silent no-op).
    const creds = await activator.activate("devnet");
    return { network: "devnet", creds, fellBack: true, reason };
  }
}
