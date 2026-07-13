# TISSUE — HANDOFF

Living state doc. Updated at every phase boundary. If you are picking this repo up,
read this top-to-bottom, then `GROUND-TRUTH.md`, then `internal/tissue-prd.md` (the spec).

**Ownership (PRD):** Daniel — daemon core, Latency Radar, replay, grade sheet ·
Tim — risk framework, exec integration, dashboard, narrative/demo.
Lanes are marked inline as `[LANE: Daniel]` / `[LANE: Tim]` / `[LANE: shared]`.

---

## TL;DR

All 10 phases have a tested first pass. **70 tests green**; all 3 packages typecheck;
`replay(corpus) === ledger` asserted in CI. The T1 gate failed (no on-chain intent-book) and
was resolved by decision **D-001** (port + honest adapter): real `validate_odds` anchoring +
an explicitly-**simulated** maker book behind a swap-in boundary. Read `GROUND-TRUTH.md` and
`feedback.md` F-001 for the evidence, `REMAINING.md` for what's left (by lane), `RUNBOOK.md`
for operations. Entry points: `pnpm --filter @tissue/daemon test:run`, `pnpm replay`.

## Current state

| Phase | Status | Notes |
|------|--------|-------|
| 0 Scaffold | ✅ done | monorepo, policy.toml, env, docs, dashboard data seam |
| 1 TxLINE spine | ✅ done | auth chain, dual SSE client, normalizer, feed-health, corpus recorder + synthetic seed (13 ingest tests green) |
| 2 Ground truth | ✅ done | GROUND-TRUTH.md — T1 fail documented, T2 consensus-granularity, T3 validate_odds semantics |
| 3 Tissue core | ✅ done | Poisson+DC, solve, in-play, fixed-point; 14 tests incl corpus property |
| 4 Latency Radar | ✅ scaffold | event→reaction→stabilization, 7 classes, unexplained→HALT, percentile bands; 7 tests. `[LANE: Daniel]` calibration (T5) |
| 5 Risk + Strategy | ✅ done | edge/A-S quotes/Kelly + risk gates (sole exec authorizer); 12 tests. `[LANE: Tim]` |
| 6 Exec | ✅ done | ExecPort + SimulatedBook (labeled, no self/external-vs-external match) + FeeLadder + real validate_odds PDA anchoring; 11 tests |
| 7 Ledger + Grader | ✅ done | hash-chained ledger + engine loop + grader (CLV/Brier/latency/per-class/PnL); replay===ledger CI proven; 11 tests |
| 8 Dashboard | ✅ scaffold | Next 16, 6 routes on mock seam, SIM badges, hash-verify; build+typecheck green |
| 9 Replay lab | ✅ done | replayCli (multi-speed) + main.ts; determinism confirmed; feed-gap chaos drill; 70 tests |
| + Analyst layer | ✅ done | `apps/analyst`: read-only MCP (3 tools) + Groq→DGrid LLM + agent; dashboard "Ask Tissue"; 8 tests. **Additive, read-only, never near the decision path** |

---

## Key decisions

### D-001 — Execution model: port + honest adapter (the T1 gate outcome)
The sponsor devnet program has **no intent-book** (`create_intent`/`execute_match`/
`claim_via_resolution`/`settle_matched_trade` do not exist; verified against commit
`f37473a`). Rather than design exec on a guessed interface, `exec/` is a **port**:

- **Anchoring is real.** Every sampled priced decision is anchored on devnet via the
  real `validate_odds` / `validate_stat` CPIs — this *is* the audit trail, permissionless
  and callable today.
- **Matching is simulated.** Fills run through an internal **simulated maker book**,
  labeled `simulated` **everywhere it surfaces** (logs, ledger records, dashboard, demo
  narration) — never presented as a real counterparty fill.
- **Swap-in boundary.** The `exec/` interface is designed so a future real permissionless
  orderbook (sponsor: "in preparation") drops in behind the same port, not a rewrite.

This preserves fill-independence (PRD §1.4): CLV grades every quote against the close
whether matched or not. Full detail + evidence in `GROUND-TRUTH.md` and `feedback.md` F-001.

### D-002 — PRD vs radar-source reconciliation
`internal/tissue-prd.md` is the sole spec. The known resolved disagreement stands:
**independent tissue price is the quoting driver; the Radar is the risk/timing overlay,
not the entry trigger.** No *further* real disagreements found between the two docs so
far (radar-source is the older, broader Latency Alpha Radar vision; tissue-prd.md
narrows and adds the pricing model + on-chain execution + proof-chain). Radar signal
taxonomy in tissue-prd.md §1.2 is a superset of radar-source §8.3 — consistent.

### D-004 — PRD-vs-feed disagreement: "possession states" (FLAG, per prompt)
The PRD (§1.1, §4) treats `Attack / Danger / HighDanger possession` as the input to the
bounded pressure modifier, worded as *possession* states. The **actual TxLINE soccer
feed has no possession-percentage stat**. `Attack/Danger/HighDanger` are values of the
`free_kick.Data.FreeKickType` enum (`Safe · Attack · Danger · HighDanger · Offside`),
i.e. danger levels of discrete events, not a continuous possession share
(`resources/tx-on-chain/documentation/scores/soccer-feed.mdx:86`). Related danger signals
in the feed: `shot.Data.Outcome`, `var.Data.Type`, dangerous `free_kick` events.

**Resolution (documented, not silent):** the pressure modifier consumes these **discrete
danger-level events** (dangerous/attacking free-kicks, shots on target) through the same
bounded, decaying model in `policy.toml [model.pressure]` — "possession states" is read
as "danger-level event states." The heuristic stays flagged on/off. If the sponsor later
exposes a true possession stat, it feeds the same modifier unchanged.

### D-005 — Feed granularity: odds stream is de-margined CONSENSUS (T2)
The odds stream is TxODDS **StablePrice** — fully de-margined consensus ("effectively
probabilities"), not raw per-book lines. The on-chain `Odds` struct carries
`bookmaker`/`bookmaker_id` slots, but the docs describe consensus semantics; no per-book
granularity should be assumed. Tissue de-vigs defensively anyway (idempotent on already
de-margined input). Detail in GROUND-TRUTH.md T2.

### D-003 — Network split (PRD §4)
Pricing inputs may use mainnet realtime (level 12). Execution, settlement, and all
provenance anchoring stay devnet (level 1 + validate_odds). Ledger records the
triggering feed/network per decision. Mainnet activation needs real SOL; if rejected,
fall back to devnet-only pricing (noted here, does not block Phase 2+).

---

### D-007 — Analyst layer: read-only narration, isolated from decisioning
`apps/analyst` is an ADDITIVE presentation layer over already-hash-chained ledger/grader
outputs. It cannot touch `policy.toml`, `risk/`, `exec/`, or ledger writes — enforced by
construction: the decision path writes a benign read-model projection (`*.analyst.json` →
`corpus/analyst.db`), and the analyst opens that SQLite **read-only** (`{ readOnly: true }`),
so any write throws at the SQLite layer (tested, not just "our tools don't write"). It exposes
exactly three read tools over MCP (`get_recent_decisions`, `get_signal_class_stats`,
`query_ledger_by_fixture`), driven by an LLM (Groq primary → DGrid fallback, per-query provider
logged) in an in-memory MCP client↔server loop. Surface: dashboard `/analyst` ("Ask Tissue")
→ server-action proxy → analyst HTTP service. Statelessness w.r.t. decisioning is tested:
running it never mutates the ledger DB and it has no trade/execute tool, so no answer can ever
produce a trade. Runs as its own process — literally cannot reach the SSE→…→exec path.

### D-006 — Live devnet activation DONE (V2 resolved)
The full auth chain ran live against `txline-dev` with a funded wallet
(`DK2H6r7djsYd4KJQywCgnPjn94552QNJUVFmtJWyzLpJ`, devnet): guest JWT → on-chain `subscribe(1,4)`
(confirmed) → `/token/activate` → real `X-Api-Token`. Real corpus `corpus/18209181.jsonl`
(FRA 2-0 MAR, 40 real scores + 43 real O/U odds) seeded via `apps/daemon/scripts/liveActivate.ts`.
Cached creds live in `apps/daemon/.keys/apitoken.json` (gitignored). Findings in feedback.md
F-002. De-vig validated against real StablePrice `Pct` (`devig.test.ts` REAL CAPTURE).
Mainnet level-12 still needs real SOL → devnet-only fallback stands (tested, D-001/V2).

## Open questions
- [ ] **Free tier has no 1X2 market** (only O/U + Asian Handicap) — tissue's 1X2 price can't
      be validated against a real 1X2 line on level 1. Options: derive 1X2 from AH+O/U, use a
      paid tier, or demo totals-real + 1X2-synthetic. Affects the real-data demo. (feedback F-002)
- [ ] Real orderbook IDL + `/api/trading/*` endpoints from sponsor (F-001) — swap into
      `exec/` when published.
- [ ] `validate_odds` return semantics (bool data vs revert-on-false) + CU cost — T3
      (now unblocked: we have an activated token to fetch real proofs).

## Next
All phases built. Remaining polish split by lane in REMAINING.md. Live SSE capture + mainnet
activation + real validate_odds submission are the open live-wiring items (need creds/SOL).
