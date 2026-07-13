import { describe, expect, it } from "vitest";
import { resolvePricingSource, type PricingActivator } from "./authOrchestrator.js";
import type { Network } from "@tissue/shared";

/**
 * V2 — the mainnet→devnet-only fallback must engage cleanly. Injected activator, no live
 * network/wallet needed. (Live status: TISSUE_KEYPAIR_PATH is not funded and no live
 * subscribe/activate has run — see the turn summary. This proves the fallback path works
 * the moment a wallet exists.)
 */

function activatorThatFails(on: Network[]): PricingActivator {
  return {
    async activate(network: Network) {
      if (on.includes(network)) throw new Error(`${network} activation rejected (insufficient SOL)`);
      return { network, jwt: `jwt-${network}`, apiToken: `tok-${network}` };
    },
  };
}

describe("V2 — pricing-source fallback", () => {
  it("falls back to devnet-only cleanly when mainnet activation is rejected", async () => {
    const src = await resolvePricingSource(activatorThatFails(["mainnet"]), { attemptMainnet: true });
    expect(src.network).toBe("devnet");
    expect(src.fellBack).toBe(true);
    expect(src.reason).toContain("mainnet activation rejected");
    expect(src.creds.apiToken).toBe("tok-devnet");
  });

  it("uses mainnet when its activation succeeds", async () => {
    const src = await resolvePricingSource(activatorThatFails([]), { attemptMainnet: true });
    expect(src.network).toBe("mainnet");
    expect(src.fellBack).toBe(false);
  });

  it("goes straight to devnet when mainnet is not attempted", async () => {
    const src = await resolvePricingSource(activatorThatFails(["mainnet"]), { attemptMainnet: false });
    expect(src.network).toBe("devnet");
    expect(src.fellBack).toBe(false);
  });

  it("fails LOUDLY if devnet also fails (no silent no-op)", async () => {
    await expect(
      resolvePricingSource(activatorThatFails(["mainnet", "devnet"]), { attemptMainnet: true }),
    ).rejects.toThrow("devnet activation rejected");
  });
});
