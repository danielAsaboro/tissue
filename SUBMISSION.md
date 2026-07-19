# TISSUE — TxODDS Trading Tools and Agents submission

**FullTime creates the conversation. Slip turns it into an agreement. Tissue finds the fair price and trades it across supported markets.**

Supported currently means Tissue's implemented 1X2 and totals families. Slip is the only
enabled venue adapter. Polymarket and other order books describe the future venue-agnostic
architecture, not completed integrations or available product controls.

## One line

Tissue is an autonomous in-play fair-value and quote-policy service that turns live TxLINE
scores and StablePrice odds into risk-controlled recommendations, halts on information risk,
verifies its inputs against TxLINE's Solana program, and proves every decision by replay.

## Judge access

Public deployment is not claimed until it exists. The project is under a user-directed embargo
for the duration of the competition. Fill these from the actual deployment only after the
competition has ended and the owner explicitly authorizes publication:

- Dashboard: **external deployment pending**
- Health/API: **external deployment pending**
- Repository: <https://github.com/danielAsaboro/tissue> — **intentionally private during the competition; do not publish yet**
- Finalized devnet TxLINE subscription: <https://explorer.solana.com/tx/qx7A7wmYnTfffUUxzvLu5fFk9eM34LzZXvfw9mDbbBJpkmjfgqYKX3gNMBve3iNzsNThnBiJWuzhbgxLBssHuDX?cluster=devnet>
- Confirmed `validate_odds` transaction: **live credential/keypair run pending**
- Confirmed pre-match hash commitment ("Proof of Edge") transaction: <https://explorer.solana.com/tx/5vSVJU2QaGmBhEcyngA6fnzyToSBjLNnN1Vq4YutXR4JTkaPg2BUVpPoPutvwkmYgKbuKGcUetXeLytkgrHvvmsm?cluster=devnet>
  (slot `477055999`) — a real confirmed SPL Memo transaction anchoring the hash of Tissue's
  opening priced-markets snapshot, submitted before this document was written.

Local judge path:

```bash
pnpm install --frozen-lockfile
pnpm run ci
pnpm run build
cp .env.example .env       # add real TxLINE credentials
docker compose up --build
```

Then open `http://localhost:3000` and inspect `http://localhost:8788/state`.

## Strategy

1. Accumulate the latest pre-match 1X2 and totals observations independent of stream arrival
   order, then freeze base scoring intensities when play begins. The free totals-only bundle
   uses a neutral team split; 1X2, when present, solves the relative scoring share.
2. Reprice the remaining match with Poisson goals, Dixon-Coles low-score dependence, verified
   current score, remaining time, and red cards. The bounded/decaying pressure heuristic remains
   replay research only; live pressure is neutralized until TxLINE exposes a proof that binds it.
3. Compare Tissue fair probability with TxLINE StablePrice consensus.
4. Publish two-sided recommendations only when edge survives quote bounds, inventory skew,
   Kelly sizing, exposure caps, feed health, radar, and model-divergence gates.
5. Publish no fill or realized PnL in live mode because no sponsor orderbook exists.

### Four additional signals, each honestly grounded in what TxLINE's real feed can support

- **Stoppage-time regime**: added time is real, live playing time, priced with a bounded
  floor/lambda-boost instead of hard-zeroing at minute 90 (a bug fix: the desk was quoting
  extra time and penalties as "no more goals possible").
- **Mutual-danger regime**: sustained simultaneous high pressure on both sides (real
  danger-level events, PRD §1.1) widens spread and cuts size — the next-goal distribution is
  bimodal there, not the Poisson point estimate's confident middle.
- **Path-dependent narrative regime**: a rolling window of the Radar's own signal-class
  history classifies the market as persistently slow, persistently nervous, or oscillating,
  and sizes to that regime rather than only the last signal.
- **Consensus-based informed-flow signal**: a Glosten-Milgrom-style adverse-selection check
  adapted honestly to what TxLINE actually exposes — StablePrice is a single de-margined
  consensus, not per-bookmaker lines (confirmed against both captured real data and the
  current live docs), so this classifies a move's *velocity* against the market's own
  trailing distribution instead of assuming cross-book propagation data that doesn't exist.
- **Stale-quote decay**: the age of Tissue's *own* resting quote (real, already-tracked
  state) compresses spread as it sits unchallenged — adapted from an idea that originally
  assumed an external on-chain intent-book, which the sponsor's devnet program does not have
  (D-001).
- **Pre-Match Hash Commitment ("Proof of Edge")**: the desk's complete pre-match opening
  (latest eligible 1X2 and totals marks, frozen when play begins), before any score message,
  is hashed and anchored via a real SPL Memo transaction — see
  Judge access above for the confirmed devnet signature.

### Strategy Arena (sponsor's "Agent vs Agent Arena" idea)

The same feed runs through the same deterministic engine twice: "Tissue" (every regime
above enabled) vs a neutralized "Baseline" (every flagged heuristic reduced to a no-op,
correctness fixes like the stoppage-time floor left on for both). Both are graded
head-to-head by the same CLV/Brier grader — a real comparison, not an assertion. Exposed at
`GET /arena[?fixtureId=]` and the dashboard's `/arena` page; also printed by `pnpm run
replay`.

## TxLINE endpoints used

- `POST /auth/guest/start` — expiring guest JWT and renewal.
- `POST /api/token/activate` — activated API token; handles observed plain-text and JSON.
- `GET /api/scores/stream` — live match state SSE.
- `GET /api/odds/stream` — live StablePrice SSE.
- `GET /api/scores/snapshot/{fixtureId}` — historical/activation capture support.
- `GET /api/odds/snapshot/{fixtureId}?asOf={ts}` — historical odds capture.
- `GET /api/odds/validation?messageId={id}&ts={ts}` — Merkle proof for `validate_odds`.
- `GET /api/scores/stat-validation?fixtureId={id}&seq={seq}&statKey={key}` — score-stat
  Merkle proof for `validate_stat`.

On-chain program IDs:

- Devnet: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Mainnet: `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`

## Production behavior

- Explicit live/replay modes; live never falls back to synthetic input.
- Dual-stream reconnection, `Last-Event-ID`, credential renewal, dedupe, watchdog halts.
- Persistent real corpora and deterministic recovery.
- Incremental live decisioning with one append-only ledger record per admitted message; restart
  verifies the persisted prefix and repairs only a deterministic missing suffix.
- Liveness/readiness endpoints and read-only SSE evidence API.
- Prometheus-format proof/stream/SSE/analyst metrics and bounded rotated container logs.
- Real proof fetch, root owner check, on-chain view, optional confirmed odds transaction; source
  proof success is required before any score or odds input can enter the live decision tape.
- Persisted inputs are freshly revalidated during recovery; local receipt JSON is never treated
  as source authority.
- Three Docker services (daemon, dashboard, read-only analyst), Compose orchestration,
  shared persistent evidence storage, health checks, and restart policy.
- Pruned compiled runtimes: production-only daemon dependencies, standalone analyst bundle, and
  Next standalone output; CI exercises the compiled entry points without `tsx`.
- Manual private release artifacts include BuildKit provenance, SBOM attestations, and SHA-256
  checksums. The workflow is read-only and cannot publish or deploy.
- Dashboard loading, empty, error/retry, halt, proof, and hash-verification states.
- Live decisions produce analyst exports; the isolated analyst service materializes its
  read model on demand and refuses to narrate synthetic fixtures.
- Three explicit analyst skills drive seven read-only MCP tools. Four use the provenance-pinned
  public Slip SDK for canonical pool, ticket, Rulebook, and creation-reference inspection. The
  agent has no signer or transaction tool, and Slip pool weights never replace Tissue fair value.
- A separately runnable live-model test proves the full model → MCP → packed SDK → canonical market
  path; the deterministic suite does not monkey-patch a successful tool response.

## Evaluation

`pnpm evaluate:fixtures -- --all` consumes the immutable authenticated TxLINE archive under
`../resources/fixtures/world-cup-2026`. Before serving a response, the local replay service
checks its raw byte length and SHA-256 against adjacent provenance, then sends the captured
JSON/SSE through the production fetchers and normalizers. This is historical replay captured
July 14—not a claim of current-live service availability.

The deterministic sha256-bucket split contains 61 calibration fixtures and 39 untouched
holdout fixtures:

| Side | Messages | Quotes | Weighted CLV | Tissue Brier | Opening baseline Brier |
|---|---:|---:|---:|---:|---:|
| Calibration | 67,017 | 4,511 | +225bps | 0.174960 | 0.161049 |
| Holdout | 42,365 | 2,681 | +225bps | 0.197298 | 0.220753 |

The complete unedited per-fixture report is
`.superstack/world-cup-evaluation.json`. Honest reading: CLV is positive and identical on
both sides; holdout Brier improves on the opening baseline, while calibration Brier regresses.
The project therefore claims reproducible positive CLV evidence, not universal calibration
superiority or historical PnL. Evaluation disables simulated fills rather than inventing a
counterparty.

## TxLINE feedback

What worked especially well:

- One normalized StablePrice schema makes strategy inputs simple and deterministic.
- Message IDs and timestamps provide strong replay/dedupe keys.
- Merkle proof endpoints and Solana validation make source evidence independently checkable.
- Dual SSE streams support event-to-market latency analysis directly.

Friction and exact findings are recorded in `feedback.md`, including activation response
shape, snapshot `asOf`, free-tier market composition, the previously undocumented odds
proof endpoint, and (F-004) a real process-level restart drill that surfaced a mainnet/devnet
IDL mismatch, empty proof-fetch errors for some older messages, and public devnet RPC rate
limiting.

## Production readiness additions since the last handoff

- Portfolio-level exposure cap + drawdown kill across every concurrently running fixture
  (`policy.risk.portfolio_*`), not just per-fixture — a loss on one fixture now halts every
  fixture the desk is running, not only the one that tripped it.
- Real process-level feed-loss/restart/recovery drill infrastructure
  (`apps/daemon/scripts/restartDrill.mjs`): spawns the COMPILED daemon as an actual OS
  process against real (proxied) TxLINE/Solana endpoints, SIGKILLs it mid-stream, restarts,
  and asserts the persisted hash chain survived. See feedback.md F-004 for what a real run
  surfaced.
- `config/policy.ts` validation is now an exhaustive recursive shape-check against every
  policy.toml field (was previously a handpicked 6-field subset) — a missing field now fails
  loudly at boot instead of silently disabling a risk gate.
- Cross-stream (scores/odds) clock skew is detected and recorded instead of silently
  clamped to "fresh."
- Extra-time/penalties pricing no longer zeroes remaining goal-scoring lambda at minute 90;
  an integer total-line push now refunds the stake instead of settling as a loss for both
  sides.
- **Real order execution, on Slip.** The sponsor's own devnet program has no order or
  execution instruction of any kind (`GROUND-TRUTH.md` T1), so real execution was never
  going to happen against TxLINE itself. `exec/slipExec.ts` turns a risk-approved decision
  into a real signed, confirmed transaction through Tissue's Slip adapter, the only enabled
  implementation of its reusable venue-execution boundary,
  gated by a second, stricter, off-by-default capital-risk check
  (`risk/gates.ts::evaluateSlipExecution`) layered on top of the existing quote-publication
  gate. Rehearsed end to end through that boundary — independently provision a two-sided market, buy only when
  opposing liquidity exists and the exact post-stake venue edge clears policy, resolve from
  a real score proof, claim,
  each step independently verified on-chain — against a local Surfpool instance running the
  real compiled Slip program (`pnpm --filter @tissue/daemon test:slip:surfpool`). Evidence
  (real market/ticket addresses and transaction signatures) is exposed on `/state`,
  `/record`, and the dashboard's `/decisions` page.
  The packed consumer also verified the hardened unified program capability and decoded five
  real markets through public devnet RPC at program `7gNEnF...bXFt`; this check was read-only.
  Mainnet-beta is deliberately refused because Slip's current `buyTicket` instruction has
  no atomic minimum-payout/slippage guard; the verified localnet/devnet path is not inflated
  into a production-capital safety claim.
- **Historical strategy evaluation through the real ingestion boundary.** The immutable
  workspace corpus contains authenticated TxLINE responses for all 100 completed World Cup
  fixtures. `pnpm evaluate:fixtures -- --all` starts a local authenticated HTTP/SSE replay
  service, verifies captured byte length and SHA-256 provenance before serving, and routes
  those responses through Tissue's production fetchers and normalizers. The fixed
  sha256-bucket split is 61 calibration / 39 holdout: both report +225bps weighted CLV.
  Holdout Brier is 0.197298 versus the opening-market baseline's 0.220753; calibration Brier
  is 0.174960 versus 0.161049, disclosed as a real regression rather than hidden. Full
  per-fixture evidence is `.superstack/world-cup-evaluation.json`.
