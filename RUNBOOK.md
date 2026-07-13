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
curl http://127.0.0.1:8788/metrics
```

- `/health` proves the process is alive even while waiting for a match.
- `/ready` is `503` until real feed data has arrived, at least one source proof has passed,
  and all hard gates are clear.
- `/state` is the dashboard source of truth; it carries no credentials or private keys.
- `/verify` recomputes every persisted decision link.
- The analyst `/health` endpoint on port `8787` reports `ready: true` only when an LLM
  provider and at least one real live export are available. It ignores `SYN-*` fixtures.
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

## Teardown

Send `SIGTERM` or `SIGINT`. The daemon stops both stream clients and closes the HTTP server.
With Compose, use `docker compose down`; keep the named corpus volume for recovery evidence.
