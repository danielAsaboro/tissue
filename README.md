# TISSUE

**Autonomous in-play fair-value and quote-policy service powered by live TxLINE data.**

**FullTime creates the conversation. Slip turns it into an agreement. Tissue finds the fair price and trades it across supported markets.**

Today, “supported markets” means Tissue's implemented 1X2 and totals pricing families. Slip
is the only enabled execution adapter. Polymarket and other order books are future adapter
targets, not connected integrations or product features.

Tissue consumes TxLINE score and StablePrice streams, freezes an opening goals model,
reprices from match state, publishes risk-approved two-sided quote recommendations, halts
when the feed or market becomes unsafe, and records every decision in a deterministic
hash chain. Live mode never invents counterparties, fills, or PnL.

> TxLINE turns live sports into verifiable state. **Tissue prices it.**

## What is real

- Dual authenticated TxLINE SSE clients with reconnect, JWT renewal, `Last-Event-ID`,
  dedupe, and independent feed-gap watchdogs.
- A deterministic Poisson + Dixon-Coles in-play pricing core. It can bootstrap from the
  free tier's totals-only bundle; 1X2 improves team-strength separation when available.
- Automated edge, inventory, exposure, drawdown, model-divergence, feed-gap, and
  unexplained-movement policy gates.
- A live quote-publication API. TxLINE's own on-chain program (`txoracle`) has no order or
  execution instructions — a data-oracle/validation program, not an orderbook (see
  `GROUND-TRUTH.md` T1). Real execution instead lands on Slip, a separate real settlement
  venue: the Slip adapter turns a risk-approved decision into a real signed, confirmed
  `buyTicket` transaction, gated by its own stricter capital-risk policy
  (`risk/gates.ts::evaluateSlipExecution`, off by default). TxLINE stays the trigger/event
  source; Slip is where a decision actually risks capital.
- TxLINE odds-proof retrieval plus real Solana `validate_odds` verification. `view` mode
  checks program state; `transaction` mode additionally submits and confirms a transaction.
- TxLINE score-stat proofs plus real Solana `validate_stat` verification for goals and red
  cards. Score and odds inputs remain outside the live corpus/engine until proof succeeds;
  unproved pressure events are neutralized in live mode.
- Persistent normalized corpora, append-only decision ledgers, deterministic replay, and
  real-corpus evaluation that rejects synthetic input. Live processing advances one shared
  engine session per fixture; recovery verifies and repairs only a missing ledger suffix.
- Five pricing regimes layered on the deterministic core: stoppage-time, mutual-danger,
  narrative regime, informed-flow detection, and stale-quote decay — each independently
  scored by the regime ablation matrix (`GET /arena/ablation`), not just bundled together.
- Every decision record is Ed25519-signed and hash-chained into a real Merkle tree with
  inclusion proofs, and carries a `policyHash` binding it to the exact policy snapshot that
  produced it. A pre-match commitment plus periodic checkpoints anchor the ledger head to
  Solana via SPL Memo; failed on-chain proofs trip a circuit breaker, not a logged warning.
- A public machine-readable record export (`GET /record`) and an in-browser third-party
  verifier at `/verify` on the dashboard: it recomputes the decision hash, checks the
  Ed25519 signature, walks the Merkle proof, and fetches the anchoring transaction directly
  from a public Solana RPC in the visitor's own browser. The daemon's server is never in the
  trust path for that last, decisive check.
- A Strategy Arena (`GET /arena`) that replays the same fixture through the same engine with
  every flagged regime neutralized, for a real head-to-head CLV/Brier comparison — not a
  second continuously running live session.
- A wallet-balance watchdog on `/health` and `/metrics` for the anchoring keypair, and a
  proof-failure circuit breaker that halts quoting rather than anchoring on a false claim.
- A connected Next.js dashboard. No mock adapter or hard-coded success path exists.
- A provenance-pinned `@slip/sdk@0.2.0` consumer with canonical market readers, WebSocket
  watchers, bigint pool/payout math, reference verification, wallet-ticket reads, and real
  transaction builders. The daemon uses this for real execution (above), signed with the
  same keypair used for on-chain anchoring; the analyst's own use of it stays read-only and
  never receives a signing key.
- Three explicit analyst skills and seven MCP tools spanning ledger forensics, Slip pool
  intelligence, and settlement-reference auditing. Slip pool weights remain evidence, not a
  substitute for Tissue fair value or TxLINE settlement truth.
- Compiled production runtimes: the daemon carries production dependencies only, the analyst is
  a standalone bundle, and the dashboard uses Next's standalone output. No service runs via `tsx`.

## Modes

Live and replay are deliberately separate:

```bash
# Explicit deterministic research/demo replay
pnpm run replay

# Real TxLINE service. Missing credentials are a fatal configuration error.
TISSUE_MODE=live pnpm run daemon
```

The daemon never falls back from live input to a corpus or synthetic match.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm run ci
pnpm run build
pnpm run replay

# Optional real-model agent/tool proof (requires an OpenAI-compatible tool-calling model).
TISSUE_LIVE_MODEL_BASE_URL=http://your-model-host/v1 \
TISSUE_LIVE_MODEL_ID=your-tool-model \
  pnpm --filter @tissue/analyst test:ai:ollama

cp .env.example .env
# Fill real TxLINE credentials, then:
docker compose up --build

# Verify final-image pruning, fail-closed startup, health, metrics, and headers.
pnpm verify:containers
```

To create or renew a real devnet subscription and capture an accessible completed fixture:

```bash
TISSUE_KEYPAIR_PATH=/absolute/path/to/devnet-keypair.json \
  pnpm --filter @tissue/daemon activate:devnet -- <fixtureId>
```

The activation command fails unless the subscription confirms, activation succeeds, and
both real score and odds rows are captured. Its credential file is owner-readable only.

Daemon evidence endpoints:

- `GET /health` — process liveness, current feed state, and anchoring wallet balance
- `GET /ready` — readiness requires real feed activity and no active halt
- `GET /state` — fixtures, decisions, quotes, radar, grades, proof, and real Slip execution evidence
- `GET /record` — public machine-readable export for independent third-party verification,
  including real Slip market/ticket addresses and transaction signatures
- `GET /verify` — recomputed decision hash-chain status
- `GET /arena` — Tissue vs. neutralized-baseline head-to-head over the same fixture
- `GET /arena/ablation` — each pricing regime isolated against the same baseline
- `GET /ledger/proof` — Merkle inclusion proof for a specific decision
- `GET /policy/snapshots` — signed policy snapshots decisions were priced against
- `GET /metrics` — bounded Prometheus proof, stream, SSE, and wallet-balance counters
- `GET /events` — server-sent live state updates

The dashboard's `/verify` page runs the full chain above client-side — hash recomputation,
signature check, Merkle walk, and the anchoring transaction fetch — directly against a public
Solana RPC from the visitor's browser, so the daemon is never trusted for the final check.

## Layout

```text
apps/daemon/src/ingest       TxLINE auth, normalization, snapshots, dual SSE
apps/daemon/src/runtime      explicit live service and durable state publication
apps/daemon/src/tissue       deterministic goals model and in-play repricing regimes
apps/daemon/src/radar        event-to-market reaction classification
apps/daemon/src/strategy     edge, inventory skew, sizing, quote proposals
apps/daemon/src/risk         sole authorization boundary — quote-publication, plus a second
                              stricter gate for real capital risked on Slip
apps/daemon/src/exec         replay book, live Solana score/odds verification, anchoring, and
                              real execution on Slip (exec/slipExec.ts)
apps/daemon/src/ledger       hash-chained, Ed25519-signed, Merkle-provable decisions
apps/daemon/src/arena        Strategy Arena and regime ablation matrix
apps/daemon/src/grader       CLV, Brier, latency, class performance
apps/daemon/src/evaluation   real-corpus-only evaluation and baselines
apps/daemon/scripts          devnet activation, Surfpool smoke test, restart/stream-drop drills
apps/dashboard               live HTTP-backed Next.js evidence console + in-browser verifier
apps/dashboard/e2e           Playwright E2E suite against a fake-daemon fixture
apps/analyst                 isolated MCP analyst over real live exports and read-only tools
packages/shared              domain contracts
packages/slip                Slip packed-SDK consumer, market views, watchers, action builders
apps/daemon/src/exec/venue.ts reusable discovery/risk/submission/reconciliation evidence boundary
vendor                       packed SDK plus source-commit and integrity provenance
docs                         Mintlify documentation site
```

Operational detail is in `RUNBOOK.md`; system architecture and Mermaid diagrams are in
`architecture.md`; bounty packaging is in `SUBMISSION.md`; API integration feedback is in
`feedback.md`.
