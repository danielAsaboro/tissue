# RUNBOOK — TISSUE desk operations

The production-readiness artifact (PRD §9). How to deploy, halt, and recover the desk.
Voice: instrument-calm. "Quoting." "Halted — feed gap." "Graded."

## Deploy

```bash
pnpm install
cp .env.example .env            # fill TISSUE_KEYPAIR_PATH + RPC + TxLINE origins
pnpm --filter @tissue/daemon test:run   # 69 tests incl. replay-equality CI
pnpm replay                     # backtest/demo over corpus/SYN-QF1.jsonl
pnpm daemon                     # run the engine (replay mode until live creds present)
```

Docker/Railway: the daemon is a single stateless process reading `policy.toml` + the corpus/
live feed. State is rebuildable from the ledger + corpus (see Recover).

## Preconditions for LIVE (vs replay)

1. `TISSUE_KEYPAIR_PATH` points to a funded **devnet** wallet (for `subscribe` + anchoring).
2. On-chain `subscribe(service_level_id=1, weeks=4)` submitted, then `/api/token/activate`
   signed → an `X-Api-Token`. Without this, snapshot/stream calls 401 (GROUND-TRUTH auth chain).
3. Mainnet realtime (level 12) is optional and needs **real SOL**; if activation is rejected,
   the desk falls back to devnet-only pricing (in_play spreads widen; see policy).

## Halt controls (all automated — no human in the loop)

The engine halts itself; these are the triggers and what an operator does about each.

| Halt | Trigger | Engine action | Operator action |
|------|---------|---------------|-----------------|
| **Feed gap** | inter-message gap ≥ `feed.max_gap_ms` | cancel all intents, SAFE | none; auto-resumes when feed returns |
| **Unexplained movement** | odds move ≥ `radar.unexplained_bps` with no event in `unexplained_window_ms` | pull quotes on that market | inspect; it means the market knows something the feed hasn't shown |
| **Model divergence** | \|tissue − market\| > `risk.model_divergence_band_bps` | pull + flag that market | check the model; protects against our own failure |
| **Drawdown kill** | drawdown ≥ `risk.drawdown_kill_units` | halt everything, **latched** | **operator restart required** — never auto-resumes |

Manual halt: stop the process (all intents are cancellable; residual refunds on cancel).
Change any threshold in `policy.toml` and restart — nothing is hard-coded.

## Recover (crash / restart)

1. **Rebuild state** from the corpus/ledger: `pnpm replay <fixtureId>` replays the exact
   decision chain; `verifyChain` confirms the ledger is intact (reports the break seq if not).
2. **Reconcile on-chain**: cancel any stale intents (simulated book resets on restart; a real
   orderbook would be reconciled against open intents by id).
3. **Resume-or-halt per policy**: if the drawdown kill was latched, the desk stays halted
   until an operator clears it deliberately.

## Verify integrity (anytime)

```bash
pnpm replay <fixtureId>   # prints: hash chain OK · determinism OK · head hash
```
`replay(corpus) === ledger` is asserted in CI — a mismatch fails the build. The dashboard's
"Verify hash chain" button runs the same check live.

## Key invariants (do not break)

- The pricing core reads no wall-clock and does no I/O — message-id/feed-ts ordering only.
- Every tunable lives in `policy.toml`. No magic numbers in logic.
- The **risk module is the only** module that green-lights execution.
- Matching is **simulated** and labeled `simulated` everywhere until the real orderbook lands.
- Anchoring (`validate_odds`) is **real** and same-network as the money (devnet).
