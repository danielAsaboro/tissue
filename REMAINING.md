# REMAINING — evidence gates, not placeholder implementation

**FullTime creates the conversation. Slip turns it into an agreement. Tissue finds the fair price and trades it across supported markets.**

Current supported pricing families are 1X2 and totals, and Slip is the only enabled venue
adapter. Polymarket and other external order books remain future adapter work; no integration
or liquidity is claimed before a complete real discovery, signing, reconciliation, and
settlement path exists.

The real live vertical slice is implemented. These items require external credentials,
current match activity, or deployment authority and must be completed with observed evidence:

1. Run the daemon with an activated TxLINE credential file for **current-live** availability
   evidence (never commit JWT/API token/keypair). Historical evidence is no longer missing:
   `../resources/fixtures/world-cup-2026` contains a SHA-256-provenanced authenticated archive,
   and `pnpm evaluate:fixtures -- --all` replays its 100 completed fixtures through the real
   HTTP/SSE fetchers and normalizers. Do not mislabel that July 14 archive as current-live.
2. Confirm at least one `validate_odds` proof in `view` mode against the current devnet root.
   Then run transaction mode with a funded keypair and retain the confirmed signature.
   Also run `verify:score-source` for the current sequenced fixture and retain its output. The
   runtime is already wired fail-closed; this run supplies the missing current external evidence.
3. Historical evaluation is now resolved at meaningful scale: 61 deterministic calibration
   fixtures and 39 frozen holdout fixtures. The remaining modeling work is to improve the
   calibration-side Brier regression without inspecting/tuning against holdout, then run the
   frozen policy once against holdout. Preserve `.superstack/world-cup-evaluation.json` as the
   pre-tuning baseline. CLV is already +225bps on both sides; Brier is mixed.
4. Build and exercise the supplied daemon/dashboard containers in private staging, with secrets
   and persistent storage. Do not create a public hostname or public registry artifact during the
   competition. After the competition has ended, an owner can authorize the judge-accessible
   application/API URLs that will replace the placeholders in `SUBMISSION.md`.
5. Exercise feed loss, process restart, proof failure, and recovery in private staging.
   Real process-level drill infrastructure now exists (`apps/daemon/scripts/restartDrill.mjs`
   + `restartDrillRelay.mjs`: spawns the COMPILED daemon as a real OS process, real proof
   verification against the real TxLINE/Solana endpoints via a relay that only replays SSE
   transport, real SIGKILL + restart + hash-chain check) — see feedback.md F-004 for what a
   real run against it surfaced (mainnet IDL mismatch, empty proof-fetch errors for some
   older messages, devnet RPC rate limiting). A fully successful end-to-end run still needs
   a currently-live match or those upstream issues resolved; the in-process recovery logic
   itself already has full unit/integration coverage independent of this drill.
6. The owner explicitly excluded public-repository and demo-video work from the current
   engineering pass. They remain literal bounty screening requirements and are not claimed
   complete. Judge-accessible application/API operation remains in engineering scope.
7. The packed-SDK public-devnet capability/read gate is resolved — see the July 19 evidence
   below. What remains open is production-capital safety: Slip's current buy instruction
   lacks a minimum-payout/slippage argument. Tissue refuses mainnet-beta execution; launch
   additionally requires an atomic venue guard (or a reviewed guard program), not merely
   another preflight read. A write lifecycle on public devnet is no longer missing from Slip
   itself, but Tissue has not spent owner funds to repeat Slip's recorded two-wallet lifecycle.

The demo video remains an absolute literal bounty requirement, but is outside the active
engineering scope by explicit owner direction.

## Resolved with real evidence (2026-07-18)

- **Pre-Match Hash Commitment ("Proof of Edge")**: `apps/daemon/src/exec/preMatchCommit.ts`
  hashes the desk's complete opening snapshot (latest eligible pre-match 1X2 and totals
  marks, frozen when play begins) and anchors it via a real SPL Memo transaction — a
  confirmed devnet signature, not a simulated proof.
  Test run against the funded devnet keypair (`/Users/mac/keys/tissue-dev.json`) produced a
  real confirmed transaction: signature
  `5vSVJU2QaGmBhEcyngA6fnzyToSBjLNnN1Vq4YutXR4JTkaPg2BUVpPoPutvwkmYgKbuKGcUetXeLytkgrHvvmsm`
  at slot `477055999` on devnet. Live wiring (`runtime/liveDesk.ts::maybeSubmitPreMatchCommitment`)
  submits automatically once per fixture, persisted to `corpus/pre-match-commitments.jsonl`
  (gitignored) and surfaced on `FixtureSnapshot.preMatchCommitment`.

## Resolved with real evidence (2026-07-19)

- **Real order execution (formerly item 7, "Revisit real order execution... " in
  feedback-roadmap.mdx).** TxLINE's own on-chain program has no order/execution
  instructions at all (confirmed against the live IDL — `GROUND-TRUTH.md` T1), so this was
  never going to resolve on TxLINE's side. `exec/slipExec.ts` now turns a risk-approved
  decision into a real signed, confirmed transaction on Slip, a separate real settlement
  venue, gated by a second stricter capital-risk check
  (`risk/gates.ts::evaluateSlipExecution`, off by default —
  `policy.exec.slip.enabled`). Along the way, found and fixed a real bug: the vendored
  `@slip/sdk` tarball had been packed before a required field (`settlement_mode`) was
  added to the on-chain program's instruction shape, silently corrupting every
  transaction built through it. Rehearsed end to end — independently provision a two-sided
  market, buy, resolve from a protocol-valid score proof, claim, and retry reconciliation,
  each step independently verified on-chain — against a local
  Surfpool instance running the real compiled Slip program
  (`apps/daemon/src/exec/slipExec.surfpool.test.ts`, `pnpm --filter @tissue/daemon
  test:slip:surfpool`).

## Resolved with real evidence (2026-07-19, hardened public Slip deployment)

- Tissue migrated from the older `8VNZ...` ABI to Slip's hardened unified program at
  `7gNEnFMDVhxFLSrtSctaPPCX7RcPbz1Lu5vtxvzobXFt`. The packed Tissue consumer called
  `supportsUnifiedMarkets()` through the public devnet RPC and observed `true`, then decoded
  five real program markets using settlement mint `9GGU...Rnj`; exact sampled addresses and
  statuses are retained in `HANDOFF.md`.
- The hardened SBF/IDL and SDK hashes are retained under `vendor/*.provenance.json`. Tissue's
  real Surfpool lifecycle passed against that exact SBF: externally provisioned two-sided
  pool, signed buy, protocol-valid TxLINE proof resolution, payout claim, and idempotent retry.
  Reconciliation now gives `void_at` precedence before proof fetching, matching Slip's
  hardened proof-versus-refund ordering.
- Cross-repository testing found and fixed a real SDK packaging defect: the clean Slip package
  passed Vite tests but failed actual Node ESM loading with `ERR_UNSUPPORTED_DIR_IMPORT` from
  Codama-generated barrels. Slip now rewrites generated relative specifiers during regeneration
  and build and runs a Node import gate; Tissue consumes the provenance-pinned result.
