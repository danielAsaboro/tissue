# Tissue — Architecture

An autonomous in-play fair-value and quote-policy desk for live football, built on
TxLINE's live scores/odds feeds and anchored on Solana. This document is the system-level
map: processes, data flow, on-chain evidence, and verification — written to be read
alongside the code, not instead of it.

Companions: [`docs/`](docs/README.md) (Mintlify reference docs), [`HANDOFF.md`](HANDOFF.md)
(project history), [`feedback.md`](feedback.md) (real findings from live integration).

## 1. Topology

Three services, one shared evidence store, two on-chain surfaces.

```mermaid
flowchart LR
    TX["TxLINE\nscores SSE + odds SSE + REST proofs"]

    subgraph runtime["Docker Compose"]
        D["daemon\ningest · verify · price · risk · quote · ledger · anchor"]
        DASH["dashboard\nNext.js, read-only HTTP client"]
        A["analyst\nread-only LLM + MCP over SQLite"]
    end

    CORPUS[("shared corpus dir\ncaptured feed · ledger JSONL · anchor evidence · policy snapshots")]

    SOL["Solana\nSPL Memo commits/checkpoints\ntxoracle validate_odds / validate_stat"]

    TX -->|SSE + REST| D
    D -->|writes| CORPUS
    D -->|serves /state /record /ledger/proof ...| DASH
    D -->|analyst export JSON| A
    D -->|anchor tx| SOL
    DASH -->|browser fetches tx directly, bypassing daemon| SOL
```

Three invariants the runtime enforces, not just documents:

1. **No synthetic fallback in live mode.** `TISSUE_MODE=live` is required; there is no
   `synthetic` mode. A missing credential or feed outage fails loudly at boot or halts
   the desk — it never substitutes fabricated data.
2. **The dashboard cannot write anything.** It only ever calls the daemon's deliberately
   scoped, read-only HTTP/SSE API. It has no database credentials of any kind.
3. **The analyst is read-only by construction, not convention.** Its SQLite connection is
   opened with `readOnly: true` at the driver level, and no write/execute/post tool
   exists anywhere in its tool registry — tested, not just claimed
   (`apps/analyst/src/adversarial.test.ts`).

## 2. The decision pipeline

Every feed message — live or replayed — passes through the same ordered pipeline. This
is the single most load-bearing fact in the whole system: replay and live share the
literal same `createEngineSession`/`runEngine` implementation, not two implementations
kept in sync by discipline.

```mermaid
flowchart TD
    MSG["TxLINE SSE message\n(score or odds)"]
    PROOF{"Source proof verification\nvalidate_odds / validate_stat CPI"}
    REJECT["Rejected — never admitted\nlogged as a proof failure"]
    STATE["Match state update\nscore · minute · cards · phase\nstoppage · mutual-danger · narrative"]
    PRICE["Tissue fair-value repricing\nPoisson + Dixon-Coles, fixed-point bps"]
    RADAR["Radar classification\nlate-reaction · overreaction · informed-flow · ..."]
    RISK{"Risk gates\n(the ONLY module authorized to green-light execution)"}
    HALT["HALT — no quote"]
    STRAT["Strategy\nedge check · quote bounds · inventory skew · Kelly sizing"]
    RECORD["Decision record\nhashed · Ed25519-signed · policy-hash-stamped"]
    LEDGER["Durable append (JSONL)\n+ periodic checkpoint anchoring"]

    MSG --> PROOF
    PROOF -->|fails| REJECT
    PROOF -->|passes| STATE
    STATE --> PRICE
    PRICE --> RADAR
    RADAR --> RISK
    RISK -->|halt condition| HALT
    RISK -->|clear| STRAT
    HALT --> RECORD
    STRAT --> RECORD
    RECORD --> LEDGER
```

Halt conditions checked by the risk gate, in the order they can fire: feed-gap,
unexplained-movement, informed-flow, model-divergence, drawdown-kill (per-fixture and
portfolio-wide), and the aggregate proof-failure-rate circuit breaker (distinct from a
single rejected message — this one fires on a *rate* of recent failures, signaling a
degraded proof service rather than one bad message).

## 3. The five pricing regimes

Each regime is an individually toggleable heuristic layered onto the Dixon-Coles core,
addressing one specific, real trading question. All five are neutralized in the Strategy
Arena's baseline agent and can be isolated one at a time via the regime ablation matrix.

| Regime | Question it answers |
|---|---|
| Stoppage-time | How should added time be priced without zeroing goal probability at minute 90? |
| Mutual-danger | How should sustained two-way pressure be priced when the next-goal distribution is bimodal? |
| Narrative regime | Is the market's own recent behavior itself informative? |
| Informed-flow | Is this price move unusually sharp for *this* market's own trailing distribution? |
| Stale-quote decay | Should an unchallenged resting quote tighten over time? |

## 4. On-chain anchoring

Two independent, real SPL Memo mechanisms, both from the daemon's own operator keypair —
Solana is the trust layer, never a counterparty (there is no real order execution; see
§7).

```mermaid
sequenceDiagram
    participant Daemon
    participant Ledger as Hash-chained ledger
    participant Solana

    Note over Daemon: Before any score message is folded into match state
    Daemon->>Daemon: hash opening priced-markets snapshot
    Daemon->>Solana: SPL Memo "tissue-pre-match-commit:<hash>"
    Solana-->>Daemon: confirmed signature + slot

    loop every N decisions (policy.exec.checkpoint_interval_decisions)
        Daemon->>Ledger: build Merkle tree over every record hash so far
        Daemon->>Solana: SPL Memo "tissue-checkpoint:<seq>:<hash of {fixtureId,seq,merkleRoot}>"
        Solana-->>Daemon: confirmed signature + slot
    end
```

The head hash of the ledger already commits to its entire prefix (`linkHash` folds every
prior record in), so anchoring a checkpoint is equivalent to anchoring a root over
everything decided so far — continuous on-chain evidence through the match, not a single
pre-kickoff snapshot.

Separately, every score and odds message is checked against TxLINE's own Merkle proof
endpoints and validated on-chain (`validate_odds` / `validate_stat`) **before** it can
enter the pipeline at all (§2) — this is *input* verification, distinct from the
*commitment* anchoring above.

## 5. Verification — how a third party checks any of this

The daemon exposes a real Merkle-proof primitive (`/ledger/proof`); the dashboard wraps
it in a client-side verifier that never trusts Tissue's own server for the decisive step.

```mermaid
sequenceDiagram
    participant Browser
    participant Dashboard as Dashboard (same-origin proxy)
    participant Daemon
    participant RPC as Public Solana RPC

    Browser->>Dashboard: GET /api/desk/record
    Dashboard->>Daemon: GET /record
    Daemon-->>Dashboard: decisions + hashes + anchor evidence
    Dashboard-->>Browser: JSON

    Note over Browser: Everything from here runs in the visitor's own browser
    Browser->>Browser: recompute decision hash (WebCrypto)
    Browser->>Browser: Ed25519-verify signature (if present)
    Browser->>Dashboard: GET /api/desk/ledger-proof
    Dashboard->>Daemon: GET /ledger/proof
    Daemon-->>Browser: leaf hash + Merkle path + root (via dashboard)
    Browser->>Browser: walk the Merkle proof locally

    Note over Browser,RPC: The decisive step — Tissue's own server is never involved
    Browser->>RPC: getTransaction(checkpoint txSig)
    RPC-->>Browser: real on-chain memo bytes
    Browser->>Browser: recompute commitment hash, compare to on-chain memo
```

A compromised or lying daemon cannot pass this check by returning `{ ok: true }` — every
step is independently recomputable, and the final comparison is against transaction
bytes fetched directly from a public RPC the daemon never touches.

`/record` (the public export), `/ledger/proof` (Merkle inclusion proofs), `/verify`
(server-computed hash-chain status — useful as a quick check, not the trust boundary),
and `/policy/snapshots` (signed policy change log) are the full read-only evidence
surface. See [`docs/verifiability.mdx`](docs/verifiability.mdx) for the complete
specification.

## 6. Testing strategy

Every layer above has a corresponding real test — not a mock of the unit under test.

- **Default suite** (322 tests, runs in every `pnpm run ci`): includes adversarial suites
  that feed the ingest pipeline and the analyst's LLM+MCP loop deliberately malformed or
  hostile input, asserting the system fails closed. This is how two real bugs were found
  and fixed during hardening (NaN-poisoned odds consensus; a blank fallback answer in the
  analyst's tool-loop limit) — see the [changelog](docs/feedback-roadmap.mdx#changelog).
- **Local Solana anchoring tests** (opt-in, `test:surfpool`): real transaction-level
  scenarios against a local Surfpool validator — confirmation, insufficient balance,
  unreachable RPC, concurrent submissions — without racing public devnet's rate limits.
- **Dashboard E2E** (opt-in, `test:e2e`): real Chromium against a real Next.js server,
  every page under every desk status, via a fake daemon HTTP process.
- **Process-level chaos drills** (opt-in, real credentials required): `drill:restart`
  SIGKILLs the compiled daemon mid-stream and asserts the persisted hash chain survives a
  hard crash; `drill:streamdrop` severs the SSE connections without killing the process
  and asserts real reconnect.

## 7. What Tissue never does

- **Never invents a fill, a counterparty, or PnL.** TxLINE's current on-chain program has
  no intent-book or order-matching instruction. Live mode publishes risk-approved quotes
  only; simulated fills exist solely in replay/research mode and are labeled `simulated`
  everywhere they surface.
- **Never falls back to synthetic data in live mode.** A missing credential or feed
  outage is a loud failure, not a silent substitution.
- **Never lets an LLM influence a decision.** The analyst is read-only by construction
  (tested), has no write tool, and no tool spec advertises write/execute capability to
  the model in the first place.
- **Never mutates strategy parameters autonomously.** `policy.toml` is the single source
  of truth for every tunable constant; tuning suggestions (`evaluate:tuning`) are
  human-reviewed and never auto-applied.

---

Built for the TxODDS World Cup Hackathon, Trading Tools and Agents track · data by
[TxLINE](https://txline.txodds.com), anchored on Solana.
