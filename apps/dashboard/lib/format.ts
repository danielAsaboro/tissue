/**
 * Presentation-only formatters. Deterministic (UTC, fixed precision) so server render
 * and any client hydration agree. Numbers are meant to be shown with tabular-nums.
 */

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

/** Epoch ms → deterministic UTC time "HH:MM:SS". */
export function formatClock(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(11, 19);
}
