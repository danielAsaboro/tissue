import type { DecisionRecord, GradeSheet, Network, RadarEvent } from "@tissue/shared";
import type { AnchorEvidence } from "../exec/anchorLive.js";
import type { QuoteRecord } from "../replay/engine.js";

export type DeskStatus = "starting" | "verifying" | "quoting" | "watching" | "halted" | "error";

export interface StreamState {
  readonly connected: boolean;
  readonly gapMs: number;
  readonly lastActivityAt: number | null;
}

export interface FixtureSnapshot {
  readonly fixtureId: string;
  readonly messages: number;
  readonly decisions: readonly DecisionRecord[];
  readonly quotes: readonly QuoteRecord[];
  readonly radarEvents: readonly RadarEvent[];
  readonly anchors: readonly AnchorEvidence[];
  readonly grade: GradeSheet;
  readonly headHash: string;
  readonly hashChainOk: boolean;
  readonly finalScore: { home: number; away: number };
}

export interface DeskSnapshot {
  readonly mode: "live";
  readonly execution: "quote-publication";
  readonly status: DeskStatus;
  readonly network: Network;
  readonly origin: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly lastFeedAt: number | null;
  readonly streams: Readonly<Record<"scores" | "odds", StreamState>>;
  readonly proofs: { readonly pending: number; readonly failed: number; readonly verified: number };
  readonly activeFixtureId: string | null;
  readonly fixtures: readonly FixtureSnapshot[];
  readonly error?: string;
}
