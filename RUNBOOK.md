# RUNBOOK — TISSUE desk operations

## Preconditions

1. Node 24 and pnpm 10.33, or Docker with Compose.
2. A real activated TxLINE subscription matching `TISSUE_NETWORK`.
3. `TXLINE_JWT` + `TXLINE_API_TOKEN`, or a credential file written by
   `apps/daemon/scripts/liveActivate.ts`.
4. A matching Solana RPC. Transaction anchoring additionally requires a funded keypair.

Copy `.env.example` to `.env`. Live startup fails with a precise error when required
configuration is absent; it never falls back to replay or sample data.

## Start

```bash
pnpm install --frozen-lockfile
pnpm run ci
pnpm run build

TISSUE_MODE=live pnpm run daemon
TISSUE_DAEMON_URL=http://127.0.0.1:8788 pnpm --filter @tissue/dashboard start
# Optional narration surface; requires GROQ_API_KEY and/or DGRID credentials.
pnpm --filter @tissue/analyst serve
```

To enable the analyst's Slip skills, set the three atomic boundaries below. WebSocket and wallet
are optional; no private key is accepted by the analyst:

```bash
TISSUE_SLIP_RPC_URL=http://127.0.0.1:8899
TISSUE_SLIP_PROGRAM_ID=<unified Slip program>
TISSUE_SLIP_SETTLEMENT_MINT=<local or cluster settlement mint>
TISSUE_SLIP_WEBSOCKET_URL=ws://127.0.0.1:8900
TISSUE_SLIP_WALLET=<optional public wallet address>
```

Partial configuration fails startup. On public clusters, first call `list_slip_markets` only after
the SDK capability check confirms the deployed unified binary. The four analyst market tools are
read-only. `@tissue/slip` contains real instruction builders for a future risk-authorized signer,
but the MCP and HTTP surfaces deliberately expose no transaction action.

The real model-to-tool loop has its own explicit test gate:

```bash
TISSUE_LIVE_MODEL_BASE_URL=http://your-openai-compatible-model/v1 \
TISSUE_LIVE_MODEL_ID=your-tool-calling-model \
  pnpm --filter @tissue/analyst test:ai:ollama
```

This test starts a protocol-valid local Solana RPC fixture, materializes a real read-only analyst
database, asks the model to invoke MCP, and requires a grounded Slip SDK result. It is excluded from
default CI only because the external model endpoint is not a repository-owned dependency.

Or:

```bash
docker compose up --build
```

Container build stages compile the daemon and analyst. Final images contain no TypeScript test or
build toolchain; `pnpm verify:runtime` exercises the exact compiled entry points before deployment.
After the images exist, `pnpm verify:containers` checks their non-root users, pruned contents,
daemon fail-closed startup, analyst health/metrics, dashboard security headers, and current
evidence copy over ephemeral loopback ports. It does not push or deploy.

## Health and evidence

```bash
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/ready
curl http://127.0.0.1:8788/verify
curl http://127.0.0.1:8788/state
curl http://127.0.0.1:8788/record
curl http://127.0.0.1:8788/arena
curl http://127.0.0.1:8788/arena/ablation
curl http://127.0.0.1:8788/metrics
```

- `/health` proves the process is alive even while waiting for a match, and reports the
  anchoring wallet's current balance and low-balance flag.
- `/ready` is `503` until real feed data has arrived, at least one source proof has passed,
  and all hard gates are clear.
- `/state` is the dashboard source of truth; it carries no credentials or private keys.
- `/record` is the public export judges or third parties can fetch directly, independent of
  the dashboard, to reproduce every hash/signature/Merkle/anchoring check by hand.
- `/verify` recomputes every persisted decision link. The dashboard's `/verify` page runs the
  equivalent chain client-side, ending in a fetch to a public Solana RPC from the browser.
- `/arena` and `/arena/ablation` replay the fixture with regimes neutralized (in aggregate
  and individually) for a real CLV/Brier comparison against the live desk.
- The analyst `/health` endpoint on port `8787` reports `ready: true` only when an LLM
  provider and at least one real live export are available. It ignores `SYN-*` fixtures and
  reports the installed skills, tool names, and whether a complete Slip boundary is configured.
- Daemon and analyst `/metrics` endpoints expose no labels derived from user/feed input. Alert on
  sustained source-proof/stream failures, analyst 429s/failures, and unexpected provider fallback.
- Compose rotates JSON logs at 10 MiB with five files per service. A private deployment must ship
  those structured logs and metrics to its durable provider before unattended operation.

## Automated halt behavior

| Trigger | Action | Resume |
|---|---|---|
| Score or odds stream gap ≥ `feed.max_gap_ms` | Publish no active quotes; status `halted` | Automatic after both streams recover |
| Unexplained market movement | Cancel recommendations for that market | Next explained/safe state |
| Model divergence | Cancel affected market recommendations | Next in-band price |
| Drawdown kill in replay venue research | Halt all, latch across restart | Deliberate operator restart only |
| Match void/abandonment | Cancel all recommendations; zero settlement | Never settles phantom score |

## Solana validation modes

- `TISSUE_ANCHOR_MODE=view`: fetch the real TxLINE proof and execute `validate_odds`
  through Solana RPC simulation. No signature is claimed.
- `TISSUE_ANCHOR_MODE=transaction`: run the view first, then submit and confirm the same
  validation instruction. Requires `TISSUE_KEYPAIR_PATH`; the dashboard links the signature.

Public state exposes only a generic proof failure; exact endpoint/RPC/account diagnostics stay
in operator logs. Neither a score nor an odds message is committed to the live corpus or allowed
to affect a quote until its validation succeeds. On recovery, persisted messages are freshly
revalidated instead of trusting the locally stored receipt.

The live admission queue verifies all four decision-driving cumulative score stats (home/away
goals and red cards) through `validate_stat` against `daily_scores_roots`. The separate command
below captures credentialed evidence for a current sequenced fixture:

```bash
TISSUE_MODE=live pnpm --filter @tissue/daemon verify:score-source -- <fixtureId>
```

Do not claim a successful live score proof until this command or the daemon has observed one on
current data; the implementation fails closed when credentials, sequence IDs, roots, or proofs
are unavailable.

## Recover

The live recorder appends normalized messages to `corpus/{fixtureId}.jsonl` and atomically
writes `corpus/live-state.json`. Each admitted update advances one in-memory deterministic
engine session and appends exactly one hash-chained ledger record; it does not replay or rewrite
the prior decision history. On restart, the next message loads the existing corpus, freshly
revalidates every persisted source record, deduplicates by TxLINE message ID, reconstructs the
same head hash, verifies any existing ledger prefix, and appends only a missing deterministic
suffix before publishing.

Verify any fixture independently:

```bash
pnpm run replay -- <fixtureId>
```

## Evaluate real matches

```bash
pnpm run evaluate:real
```

The evaluator rejects `SYN-*` and ledger files. It reports per-fixture and aggregate CLV,
Brier score, market baseline where 1X2 exists, pressure-ablation CLV, message/quote counts,
and the decision-chain head. No result is produced if no real corpus is available.

## Resilience drills

Process-level drills that prove reconnect/recovery behavior without needing a live match or
on-chain proof to succeed:

```bash
pnpm --filter @tissue/daemon drill:restart      # kill -9 the daemon mid-session, confirm recovery
pnpm --filter @tissue/daemon drill:streamdrop    # force-sever the SSE connection, confirm reconnect
```

`apps/dashboard` also has a real Playwright E2E suite against a fake-daemon fixture
(`pnpm --filter @tissue/dashboard test:e2e`), and Surfpool-backed transaction-level anchoring
tests are opt-in via `SURFPOOL_RPC_URL` (`pnpm --filter @tissue/daemon test:surfpool`).

## Teardown

Send `SIGTERM` or `SIGINT`. The daemon stops both stream clients and closes the HTTP server.
With Compose, use `docker compose down`; keep the named corpus volume for recovery evidence.
