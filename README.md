# TISSUE

**Autonomous in-play fair-value and quote-policy service powered by live TxLINE data.**

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
- A live quote-publication API. It publishes recommendations; it does not claim a fill
  because TxLINE currently exposes no orderbook venue.
- TxLINE odds-proof retrieval plus real Solana `validate_odds` verification. `view` mode
  checks program state; `transaction` mode additionally submits and confirms a transaction.
- TxLINE score-stat proofs plus real Solana `validate_stat` verification for goals and red
  cards. Score and odds inputs remain outside the live corpus/engine until proof succeeds;
  unproved pressure events are neutralized in live mode.
- Persistent normalized corpora, append-only decision ledgers, deterministic replay, and
  real-corpus evaluation that rejects synthetic input. Live processing advances one shared
  engine session per fixture; recovery verifies and repairs only a missing ledger suffix.
- A connected Next.js dashboard. No mock adapter or hard-coded success path exists.
- A provenance-pinned `@slip/sdk@0.2.0` consumer with canonical market readers, WebSocket
  watchers, bigint pool/payout math, reference verification, wallet-ticket reads, and real
  transaction builders. The analyst exposes only the read side; it never receives a signing key.
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

- `GET /health` — process liveness and current feed state
- `GET /ready` — readiness requires real feed activity and no active halt
- `GET /state` — fixtures, decisions, quotes, radar, grades, and proof evidence
- `GET /verify` — recomputed decision hash-chain status
- `GET /metrics` — bounded Prometheus proof, stream, and SSE counters
- `GET /events` — server-sent live state updates

## Layout

```text
apps/daemon/src/ingest       TxLINE auth, normalization, snapshots, dual SSE
apps/daemon/src/runtime      explicit live service and durable state publication
apps/daemon/src/tissue       deterministic goals model and in-play repricing
apps/daemon/src/radar        event-to-market reaction classification
apps/daemon/src/strategy     edge, inventory skew, sizing, quote proposals
apps/daemon/src/risk         sole quote-publication authorization boundary
apps/daemon/src/exec         replay book + live Solana score/odds verification boundary
apps/daemon/src/ledger       hash-chained decisions
apps/daemon/src/grader       CLV, Brier, latency, class performance
apps/daemon/src/evaluation   real-corpus-only evaluation and baselines
apps/dashboard               live HTTP-backed Next.js evidence console
apps/analyst                 isolated MCP analyst over real live exports and read-only tools
packages/shared              domain contracts
packages/slip                generic packed-SDK consumer, market views, watchers, action builders
vendor                       packed SDK plus source-commit and integrity provenance
```

Operational detail is in `RUNBOOK.md`; bounty packaging is in `SUBMISSION.md`; API
integration feedback is in `feedback.md`.
