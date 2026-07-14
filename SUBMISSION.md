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

`pnpm run evaluate:real` accepts only real TxLINE corpora. Final metrics must be pasted here
from an observed multi-fixture calibration/holdout run; no synthetic metric is submitted as
trading performance.

## TxLINE feedback

What worked especially well:

- One normalized StablePrice schema makes strategy inputs simple and deterministic.
- Message IDs and timestamps provide strong replay/dedupe keys.
- Merkle proof endpoints and Solana validation make source evidence independently checkable.
- Dual SSE streams support event-to-market latency analysis directly.

Friction and exact findings are recorded in `feedback.md`, including activation response
shape, snapshot `asOf`, free-tier market composition, and the previously undocumented odds
proof endpoint.
