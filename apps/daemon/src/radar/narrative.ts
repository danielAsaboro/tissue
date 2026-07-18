import type { NarrativeRegime, RadarClass, RadarEvent } from "@tissue/shared";

/**
 * Path-dependent narrative classifier (PRD extension). Radar events are memoryless — each
 * one classifies a single event→reaction pair. This layers a rolling-window regime on top:
 * a market that's been persistently slow (stale-line/late-reaction) for 20 minutes is a
 * different sizing decision than one persistently overreacting, which is different again
 * from one oscillating between the two with no stable price. Pure, deterministic, windowed
 * by feed ts only — no wall-clock, no ML.
 */

export interface NarrativeConfig {
  /** Rolling lookback window in ms (policy.radar.narrative.window_ms). */
  readonly windowMs: number;
  /** Fraction of in-window events one side of the taxonomy must hold to dominate. */
  readonly dominanceFraction: number;
  /** Minimum in-window event count before a regime other than "neutral" is claimed. */
  readonly minSamples: number;
}

const COMPOUNDING_CLASSES: ReadonlySet<RadarClass> = new Set(["stale-line", "late-reaction"]);
const CAUTIOUS_CLASSES: ReadonlySet<RadarClass> = new Set(["overreaction", "favorite-panic"]);

/**
 * Classifies the market's regime over the trailing window ending at `atTs`. Only
 * COMPOUNDING_CLASSES and CAUTIOUS_CLASSES events participate in the taxonomy; other
 * signal classes (fast-reaction, draw-compression, unexplained-movement) are informative
 * events elsewhere but don't feed this specific slow-vs-nervous axis.
 */
export function classifyNarrative(
  events: readonly RadarEvent[],
  atTs: number,
  cfg: NarrativeConfig,
): NarrativeRegime {
  const windowStart = atTs - cfg.windowMs;
  const taxonomy: ("compounding" | "cautious")[] = [];
  for (const e of events) {
    if (e.eventTs < windowStart || e.eventTs > atTs) continue;
    if (COMPOUNDING_CLASSES.has(e.signalClass)) taxonomy.push("compounding");
    else if (CAUTIOUS_CLASSES.has(e.signalClass)) taxonomy.push("cautious");
  }
  if (taxonomy.length < cfg.minSamples) return "neutral";

  const compoundingN = taxonomy.filter((t) => t === "compounding").length;
  const cautiousN = taxonomy.length - compoundingN;
  if (compoundingN / taxonomy.length >= cfg.dominanceFraction) return "compounding";
  if (cautiousN / taxonomy.length >= cfg.dominanceFraction) return "cautious";

  // Neither side dominates: alternating (oscillating) vs a genuine mixed bag (neutral).
  // Alternation = consecutive samples differ more often than not (a real back-and-forth,
  // not just an even split that happened to cluster).
  let switches = 0;
  for (let i = 1; i < taxonomy.length; i++) if (taxonomy[i] !== taxonomy[i - 1]) switches++;
  const switchRate = switches / (taxonomy.length - 1);
  return switchRate >= 0.5 ? "oscillating" : "neutral";
}
