import type { Intent, MarketKey, Selection, Side } from "@tissue/shared";
import { marketKeyString } from "@tissue/shared";

/**
 * Stale-quote decay (adapted from the "Dead Intent Decay" pitch). The original idea tracked
 * the age of OTHER makers' unmatched intents on a live on-chain orderbook — TxLINE's sponsor
 * program has no such orderbook (D-001, GROUND-TRUTH.md T1). The honest, real-state version:
 * track the age of TISSUE'S OWN posted-but-unmatched quote. The longer the desk's current
 * resting price has sat unchallenged while the market kept ticking, the more the price has
 * had a chance to be "tested" without disagreement — compress spread slightly (tighten,
 * lean in) as it ages, bounded, so a genuinely fresh price isn't penalized and an old one
 * doesn't compress without limit.
 */

export interface StaleQuoteConfig {
  /** Time (ms) to reach full compression. */
  readonly decayMs: number;
  /** Floor spread multiplier at/after decayMs (e.g. 0.7 = at most 30% tighter). */
  readonly minSpreadMult: number;
}

/** Age (ms) of the most recently posted still-open intent on this selection+side, or 0. */
export function restingQuoteAgeMs(
  openIntents: readonly Intent[],
  marketKey: MarketKey,
  selection: Selection,
  side: Side,
  nowTs: number,
): number {
  const key = marketKeyString(marketKey);
  let latestCreatedTs: number | null = null;
  for (const i of openIntents) {
    if (marketKeyString(i.marketKey) !== key || i.selection !== selection || i.side !== side) continue;
    if (latestCreatedTs === null || i.createdTs > latestCreatedTs) latestCreatedTs = i.createdTs;
  }
  if (latestCreatedTs === null) return 0;
  return Math.max(0, nowTs - latestCreatedTs);
}

/** Linear ramp from 1.0 (fresh) down to minSpreadMult (fully decayed), clamped. */
export function staleQuoteSpreadMult(ageMs: number, cfg: StaleQuoteConfig): number {
  if (cfg.decayMs <= 0) return 1;
  const t = Math.max(0, Math.min(1, ageMs / cfg.decayMs));
  return 1 - t * (1 - cfg.minSpreadMult);
}
