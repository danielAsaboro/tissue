import type { DecisionRecord, FeedMessage } from "@tissue/shared";
import type { AnchorEvidence } from "../exec/anchorLive.js";
import type { PreMatchCommitmentEvidence } from "../exec/preMatchCommit.js";
import type { CheckpointAnchorEvidence } from "../exec/periodicAnchor.js";
import type { VenueExecutionEvidence } from "../exec/venue.js";
import type { PolicySnapshotEntry } from "../config/policySnapshot.js";
import type { LiveStore } from "./liveStore.js";

/** In-process fake of LiveStore for tests — same append/read contract, zero network. */
export function createInMemoryLiveStore(): LiveStore {
  const tapes = new Map<string, FeedMessage[]>();
  const decisions = new Map<string, DecisionRecord[]>();
  const policySnapshots: PolicySnapshotEntry[] = [];
  const anchorEvidence: AnchorEvidence[] = [];
  const preMatchCommitments: PreMatchCommitmentEvidence[] = [];
  const checkpoints: CheckpointAnchorEvidence[] = [];
  const venueExecutions: VenueExecutionEvidence[] = [];

  return {
    async appendLiveMessage(fixtureId, message) {
      const tape = tapes.get(fixtureId) ?? [];
      tape.push(message);
      tapes.set(fixtureId, tape);
    },
    async readLiveTape(fixtureId) {
      return [...(tapes.get(fixtureId) ?? [])];
    },
    async liveTapeExists(fixtureId) {
      return tapes.has(fixtureId);
    },

    async appendDecision(fixtureId, record) {
      const list = decisions.get(fixtureId) ?? [];
      list.push(record);
      decisions.set(fixtureId, list);
    },
    async readDecisions(fixtureId) {
      return [...(decisions.get(fixtureId) ?? [])];
    },

    async appendPolicySnapshotRow(entry) {
      policySnapshots.push(entry);
    },
    async readAllPolicySnapshotRows() {
      return [...policySnapshots];
    },
    async readLastPolicySnapshotRow() {
      return policySnapshots.at(-1);
    },

    async appendAnchorEvidenceRow(evidence) {
      anchorEvidence.push(evidence);
    },
    async readAllAnchorEvidenceRows() {
      return [...anchorEvidence];
    },

    async appendPreMatchCommitmentRow(evidence) {
      preMatchCommitments.push(evidence);
    },
    async readAllPreMatchCommitmentRows() {
      return [...preMatchCommitments];
    },

    async appendCheckpointRow(evidence) {
      checkpoints.push(evidence);
    },
    async readAllCheckpointRows() {
      return [...checkpoints];
    },

    async appendVenueExecutionRow(evidence) {
      venueExecutions.push(evidence);
    },
    async readAllVenueExecutionRows() {
      return [...venueExecutions];
    },

    async close() {},
  };
}
