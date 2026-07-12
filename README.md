# TISSUE

**Autonomous in-play trading desk with a latency radar and a backtest that can't lie.**

Tissue builds its own fair price for every live World Cup market from the match itself —
goals, cards, minute, pressure — quotes both sides on-chain when the market disagrees,
refuses to trade against information it can't see, and grades itself in public with a
proof-chained log.

> TxLINE turns live sports into verifiable state. **Tissue prices it.**

## Layout

```
apps/daemon        TS + tsx daemon. Hard module boundaries (PRD §5):
  src/ingest         TxLINE auth + dual SSE + corpus recorder
  src/state          in-play match state machine
  src/tissue         pure, cited, tested pricing core (the jewel)
  src/radar          Latency Radar (Daniel's lane)
  src/strategy       edge + inventory-skewed quoting (Tim's lane)
  src/risk           risk gates — the only module that green-lights execution
  src/exec           exec port: simulated maker book + real validate_odds anchoring
  src/ledger         hash-chained decision records
  src/grader         CLV / Brier / PnL / latency / per-class hit rates
  src/replay         corpus replay = backtester + demo generator
apps/dashboard     Next.js headless skeleton on a mock data seam
packages/shared    domain types (the cross-cutting contract)
policy.toml        every tunable constant (PRD §4)
```

## Execution model — read this first

The sponsor's on-chain program has **no intent-book**. Rather than design execution on a
guessed interface, `exec/` is a **port**: provenance anchoring uses the real
`validate_odds` / `validate_stat` CPIs (permissionless, callable today), while
matching/fills run through an internal **simulated maker book, labeled `simulated`
everywhere it surfaces**. A future real orderbook swaps in behind the same boundary.
Full detail: `GROUND-TRUTH.md`, `HANDOFF.md`, `feedback.md`.

## Dev

```
pnpm install
pnpm --filter @tissue/daemon test      # pricing units, property tests, replay-equality CI
pnpm --filter @tissue/daemon replay    # replay a corpus fixture
```

Model lineage: de-vig consensus → Poisson goals with Dixon–Coles rho (Dixon & Coles 1997),
inventory-skewed quoting (Avellaneda–Stoikov 2008). Fixed-point (integer bps), message-id
ordering, no wall-clock in decisions → `replay(corpus) === ledger`, asserted in CI.
