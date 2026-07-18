# REMAINING — evidence gates, not placeholder implementation

The real live vertical slice is implemented. These items require external credentials,
current match activity, or deployment authority and must be completed with observed evidence:

1. Run the daemon with the activated TxLINE credential file and capture current real SSE
   traffic into checked evidence corpora (never commit JWT/API token/keypair).
   The official schedule currently lists semifinal fixture `18237038` (France–Spain) for
   2026-07-14 19:00 UTC and `18241006` (England–Argentina) for 2026-07-15 19:00 UTC:
   <https://txline.txodds.com/documentation/scores/schedule>.
2. Confirm at least one `validate_odds` proof in `view` mode against the current devnet root.
   Then run transaction mode with a funded keypair and retain the confirmed signature.
   Also run `verify:score-source` for the current sequenced fixture and retain its output. The
   runtime is already wired fail-closed; this run supplies the missing current external evidence.
3. Run `pnpm run evaluate:real` over multiple fixtures. Publish the unedited output and tune
   policy only with a documented calibration/holdout split (tooling now exists —
   `pnpm --filter @tissue/daemon evaluate:calibration`, `apps/daemon/src/evaluation/calibrationSplit.ts`
   — deterministic sha256-bucketed split, honest about being underpowered below 3 fixtures/side.
   Currently underpowered with only 2 real corpora on disk; needs more real captures to be
   statistically meaningful).
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
6. Keep `danielAsaboro/tissue` private during the competition as directed. After the competition
   has ended, an owner/admin can make it public when publication is authorized; do not change
   visibility now.
7. The July 14 packed-SDK devnet capability check returned `unifiedMarkets: false`. After Slip's
   unified binary is upgraded, run the packed Tissue consumer against that public
   deployment: capability detection, list/read/watch, real multi-wallet stake, ticket read,
   permissionless proof resolution, claim/refund, and teardown. Until then the checked evidence is
   the protocol-valid local RPC contract plus Slip's real Surfpool lifecycle, not a Tissue devnet run.

Video recording is explicitly outside the current implementation objective.

## Resolved with real evidence (2026-07-18)

- **Pre-Match Hash Commitment ("Proof of Edge")**: `apps/daemon/src/exec/preMatchCommit.ts`
  hashes the desk's first priced-markets snapshot (before any score message) and anchors it
  via a real SPL Memo transaction — a confirmed devnet signature, not a simulated proof.
  Test run against the funded devnet keypair (`/Users/mac/keys/tissue-dev.json`) produced a
  real confirmed transaction: signature
  `5vSVJU2QaGmBhEcyngA6fnzyToSBjLNnN1Vq4YutXR4JTkaPg2BUVpPoPutvwkmYgKbuKGcUetXeLytkgrHvvmsm`
  at slot `477055999` on devnet. Live wiring (`runtime/liveDesk.ts::maybeSubmitPreMatchCommitment`)
  submits automatically once per fixture, persisted to `corpus/pre-match-commitments.jsonl`
  (gitignored) and surfaced on `FixtureSnapshot.preMatchCommitment`.
