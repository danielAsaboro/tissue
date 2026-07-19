# TISSUE — TxODDS Trading Tools and Agents submission

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

1. Freeze base scoring intensities from the opening de-vigged market. The free totals-only
   bundle uses a neutral team split; 1X2, when present, solves the relative scoring share.
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
- **Pre-Match Hash Commitment ("Proof of Edge")**: the desk's first priced-markets snapshot,
  before any score message, is hashed and anchored via a real SPL Memo transaction — see
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

`pnpm run evaluate:real` accepts only real TxLINE corpora — it hard-fails on a clean checkout
with no real data (never falls back to synthetic). Currently 2 real fixtures are captured
(one devnet, `18209181`; one mainnet, `17588302`). Unedited output, `pnpm run evaluate:real`:

```json
{
  "generatedAt": "2026-07-18T04:21:26.792Z",
  "source": "real-txline-corpora-only",
  "fixtures": [
    {
      "fixtureId": "17588302",
      "messages": 72,
      "decisions": 72,
      "quotes": 14,
      "clvN": 14,
      "meanClvBps": -216,
      "brier": 0.28045374080645147,
      "marketBaselineBrier": null,
      "withoutPressureMeanClvBps": -216,
      "hashChainHead": "cab4435dd40906ecfc51cbabc17b221aa11107cf079bb6cf2d5ff3feffa394eb"
    },
    {
      "fixtureId": "18209181",
      "messages": 83,
      "decisions": 83,
      "quotes": 24,
      "clvN": 24,
      "meanClvBps": 453,
      "brier": 0.2126982911594204,
      "marketBaselineBrier": null,
      "withoutPressureMeanClvBps": 453,
      "hashChainHead": "5d0c0f7157be555f2ead99fc53e955c0e7fb2b28e7eee24d0af0764e92b8c3a8"
    }
  ],
  "aggregate": {
    "fixtures": 2,
    "messages": 155,
    "quotes": 38,
    "clvN": 38,
    "weightedMeanClvBps": 207,
    "meanTissueBrier": null,
    "meanMarketBaselineBrier": null
  }
}
```

Calibration/holdout split tooling (`pnpm --filter @tissue/daemon evaluate:calibration`,
`apps/daemon/src/evaluation/calibrationSplit.ts` — deterministic sha256-bucketed split, never
insertion order) now exists in code, closing what was previously a documented-but-unimplemented
gap. Unedited output against the same 2 real fixtures:

```json
{
  "generatedAt": "2026-07-18T04:21:35.611Z",
  "source": "real-txline-corpora-only",
  "holdoutFraction": 0.3,
  "calibration": { "fixtureIds": ["18209181"], "fixtures": 1, "clvN": 24, "weightedMeanClvBps": 453, "meanBrier": 0.2126982911594204 },
  "holdout": { "fixtureIds": ["17588302"], "fixtures": 1, "clvN": 14, "weightedMeanClvBps": -216, "meanBrier": 0.28045374080645147 },
  "underpowered": true
}
```

**Honest reading:** with only 2 real fixtures the split is `underpowered: true` by the tool's
own threshold (fewer than 3 fixtures per side) — this is a working tool with an honest
insufficient-sample flag, not a validated calibration result. No policy tuning has been done
against these numbers. More real captures are needed before any calibration/holdout
conclusion is trustworthy; the mean-CLV sign flip between the two single-fixture "sides"
above is exactly the kind of noise the underpowered flag exists to catch.

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
  into a real signed, confirmed transaction on Slip, a separate real settlement venue,
  gated by a second, stricter, off-by-default capital-risk check
  (`risk/gates.ts::evaluateSlipExecution`) layered on top of the existing quote-publication
  gate. Rehearsed end to end — create market, buy, resolve from a real score proof, claim,
  each step independently verified on-chain — against a local Surfpool instance running the
  real compiled Slip program (`pnpm --filter @tissue/daemon test:slip:surfpool`). Evidence
  (real market/ticket addresses and transaction signatures) is exposed on `/state`,
  `/record`, and the dashboard's `/decisions` page.
