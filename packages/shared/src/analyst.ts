import type { DecisionRecord } from "./decision.js";
import type { RadarEvent } from "./radar.js";
import type { GradeSheet } from "./grade.js";

/**
 * Analyst export — the read-model contract between the decision path (which writes it, as
 * a benign projection of already-hash-chained data) and the read-only analyst layer (which
 * materializes it into SQLite). The analyst NEVER produces this; it only consumes it.
 */
export interface AnalystExport {
  readonly fixtureId: string;
  readonly generatedAtMsgId: string;
  readonly decisions: readonly DecisionRecord[];
  readonly radarEvents: readonly RadarEvent[];
  readonly grade: GradeSheet;
  readonly finalScore: { readonly home: number; readonly away: number };
}
