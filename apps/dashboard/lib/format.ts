import type { MarketKey } from "@tissue/shared";

/**
 * Presentation-only formatters. Deterministic (UTC, fixed precision) so server render
 * and any client hydration agree. Numbers are meant to be shown with tabular-nums.
 */

/** Human label for a market key ("1X2", "TOTALS@2.5"). Presentation of a domain type. */
export function formatMarketKey(key: MarketKey): string {
  return key.lineTimes10 == null
    ? key.market
    : `${key.market}@${key.lineTimes10 / 10}`;
}

/** MilliOdds (decimal odds × 1000) → "1.92". */
export function formatMilliOdds(milliOdds: number): string {
  return (milliOdds / 1000).toFixed(2);
}

/** Bps of probability (10000 = 100%) → "52.00%". */
export function formatBpsPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Signed bps edge → "+38" / "-10". */
export function formatBpsSigned(bps: number): string {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps}`;
}

/** Integer money units, grouped. */
export function formatUnits(units: number): string {
  return units.toLocaleString("en-US");
}

/** A 0..1 fraction → "62.0%". */
export function formatFractionPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Milliseconds → "4,200 ms". */
export function formatMs(ms: number): string {
  return `${ms.toLocaleString("en-US")} ms`;
}

/** Epoch ms → deterministic UTC date + time "2026-06-19 01:00:00 UTC". Always includes the
 *  date: fixtures span a multi-week tournament window, so time-of-day alone can't tell two
 *  decisions from different matches apart. */
export function formatClock(tsMs: number): string {
  return `${new Date(tsMs).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

/** ISO 8601 kickoff → "Jun 19, 2026". Coarser than formatClock — a page-level match label,
 *  not a per-row timestamp. */
export function formatMatchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
