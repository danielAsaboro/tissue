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
   policy only with a documented calibration/holdout split.
4. Build and exercise the supplied daemon/dashboard containers in private staging, with secrets
   and persistent storage. Do not create a public hostname or public registry artifact during the
   competition. After the competition has ended, an owner can authorize the judge-accessible
   application/API URLs that will replace the placeholders in `SUBMISSION.md`.
5. Exercise feed loss, process restart, proof failure, and recovery in private staging.
6. Keep `danielAsaboro/tissue` private during the competition as directed. After the competition
   has ended, an owner/admin can make it public when publication is authorized; do not change
   visibility now.
7. The July 14 packed-SDK devnet capability check returned `unifiedMarkets: false`. After Slip's
   unified binary is upgraded, run the packed Tissue consumer against that public
   deployment: capability detection, list/read/watch, real multi-wallet stake, ticket read,
   permissionless proof resolution, claim/refund, and teardown. Until then the checked evidence is
   the protocol-valid local RPC contract plus Slip's real Surfpool lifecycle, not a Tissue devnet run.

Video recording is explicitly outside the current implementation objective.
