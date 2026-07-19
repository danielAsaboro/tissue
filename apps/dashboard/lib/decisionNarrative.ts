import type { DecisionRecord, RadarClass } from "@tissue/shared";
import { formatBpsPct, formatBpsSigned } from "./format";
import { haltEdgeCopy } from "./haltCopy";

/** What each radar signal class means, in one clause — the taxonomy's own naming plus
 *  packages/shared/src/radar.ts's regime grouping (compounding = stale-line/late-reaction,
 *  cautious = overreaction/favorite-panic). */
const RADAR_CLASS_EXPLANATION: Record<RadarClass, string> = {
  "late-reaction": "the market was slow to react to this event",
  "fast-reaction": "the market reacted unusually fast to this event",
  overreaction: "the market overshot in reaction to this event",
  "stale-line": "the market's price hadn't moved despite new information",
  "draw-compression": "the draw price compressed sharply",
  "favorite-panic": "the favorite's price moved as if the market panicked",
  "unexplained-movement": "the price moved with no matching event to explain it",
  "informed-flow": "this order-flow pattern looks like informed trading",
};

const ACTION_VERB: Record<"POST" | "REPLACE" | "CANCEL", string> = {
  POST: "Posted a new quote",
  REPLACE: "Replaced the resting quote",
  CANCEL: "Cancelled the resting quote",
};

/**
 * Deterministic plain-English sentence for one decision — no LLM, no network call, derived
 * only from fields already on the record. Answers "what did the desk do, and why" without
 * requiring a reader to reconstruct it from bps/hashes/timestamps by hand.
 */
export function explainDecision(record: DecisionRecord): string {
  const action = record.action;
  const signal = record.radarClass ? RADAR_CLASS_EXPLANATION[record.radarClass] : null;
  const priceCompare = `Tissue priced this at ${formatBpsPct(record.tissueProb)} vs the market's ${formatBpsPct(record.marketProb)} (${formatBpsSigned(record.edgeBps)}bps edge)`;

  if (action === "HALT") {
    const headline = record.haltReason ? `Halted — ${record.haltReason}.` : "Halted.";
    const edge = record.haltReason ? haltEdgeCopy(record.haltReason) : null;
    return edge ? `${headline} ${edge}` : headline;
  }

  if (action === "NO_ACTION") {
    return signal
      ? `No quote posted — ${signal}, but the edge (${formatBpsSigned(record.edgeBps)}bps) didn't clear the bar to act on.`
      : `No quote posted — ${priceCompare}, not enough to act on.`;
  }

  const verb = ACTION_VERB[action];
  const n = record.intents.length;
  const sizing = n > 0 ? ` (${n} intent${n === 1 ? "" : "s"})` : "";
  return signal ? `${verb}${sizing} — ${signal}. ${priceCompare}.` : `${verb}${sizing} — ${priceCompare}.`;
}
