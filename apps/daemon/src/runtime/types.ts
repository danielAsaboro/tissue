import type { DecisionRecord, GradeSheet, Network, RadarEvent } from "@tissue/shared";
import type { AnchorEvidence } from "../exec/anchorLive.js";
import type { PreMatchCommitmentEvidence } from "../exec/preMatchCommit.js";
import type { CheckpointAnchorEvidence } from "../exec/periodicAnchor.js";
import type { VenueExecutionEvidence } from "../exec/venue.js";
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
  /** "Proof of Edge" — the pre-kickoff commitment, once submitted (exec/preMatchCommit.ts). */
  readonly preMatchCommitment: PreMatchCommitmentEvidence | null;
  /** Periodic on-chain checkpoints of the ledger head hash through the match
   *  (exec/periodicAnchor.ts, policy.exec.checkpoint_interval_decisions). */
  readonly checkpoints: readonly CheckpointAnchorEvidence[];
  /** Real venue execution evidence, one row per approved or adapter-gate-rejected intent.
   * Slip is currently the only registered adapter; an empty list never implies a fake fill. */
  readonly venueExecutions: readonly VenueExecutionEvidence[];
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
  readonly proofs: { readonly pending: number; readonly failed: number; readonly verified: number; readonly circuitKilled: boolean };
  readonly activeFixtureId: string | null;
  readonly fixtures: readonly FixtureSnapshot[];
  /** Aggregate risk ACROSS every concurrently running fixture (policy.risk.portfolio_*). */
  readonly portfolio: {
    readonly exposureUnits: number;
    readonly drawdownUnits: number;
    readonly killed: boolean;
  };
  /** Real, periodically-refreshed balance of the anchoring keypair. null when no keypair is
   *  configured or no successful balance check has landed yet. */
  readonly wallet: {
    readonly pubkey: string | null;
    readonly lamports: number | null;
    readonly low: boolean;
    readonly checkedAt: number | null;
  };
  readonly error?: string;
}
