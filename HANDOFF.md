# TISSUE — HANDOFF

Living state doc. Updated at every phase boundary. If you are picking this repo up,
read this top-to-bottom, then `GROUND-TRUTH.md`, then `internal/tissue-prd.md` (the spec).

## 2026-07-13 live vertical-slice update (supersedes older execution/dashboard notes)

- `pnpm daemon` is now an explicit **live-only** service. It requires `TISSUE_MODE=live`
  and real TxLINE credentials; it never falls back to replay or synthetic input.
- The dual SSE clients are connected to the deterministic engine, durable corpora/ledgers,
  crash reconstruction, and a read-only `/health` `/ready` `/state` `/verify` `/events` API.
- Live execution is **quote publication**, not simulated matching. Risk-approved quotes are
  real API outputs; no counterparty, fill, or PnL is invented. The simulated maker book is
  retained only for explicit replay research.
- The dashboard consumes the daemon API. The mock adapter and non-functional replay controls
  were removed; unavailable/empty/error/proof states are explicit.
- Totals-only bootstrap is implemented for the actual free-tier bundle that lacks 1X2.
- The now-published `/api/odds/validation?messageId=&ts=` endpoint is implemented. Proofs are
  decoded strictly, the root account owner is checked, `validate_odds` runs via real RPC view,
  and optional transaction mode records confirmation evidence. Verification now precedes live
  corpus commit and quote publication; failed/pending odds never enter the decision tape.
- Score admission now carries TxLINE sequence IDs and validates home/away goals and red cards
  with `validate_stat` against `daily_scores_roots` before decisioning. Recovery freshly
  revalidates persisted score and odds inputs rather than trusting local receipt JSON.
- Public error surfaces are sanitized; operator logs retain diagnostics. The analyst boundary
  has bounded inputs/provider responses, a 4-request concurrency ceiling, and a 30/minute cap.
- Production containers now run compiled artifacts: a production-dependency-only daemon,
  dependency-free analyst bundle, and Next standalone server. `pnpm verify:runtime` starts and
  checks those artifacts; no final image executes through `tsx`.
- Live admission now advances the shared deterministic engine incrementally and appends one
  ledger record per message. Corpus-first crash recovery verifies the existing prefix and repairs
  only the missing suffix. A 195-message local comparison measured 72 ms incremental versus
  7,390 ms for repeated prefix replay (102×), with the same final head hash.
- `.github/workflows/private-release.yml` can manually create private OCI artifacts with SBOM,
  provenance, and SHA-256 evidence. It has read-only permissions and cannot push, deploy, publish,
  or change visibility; promotion gates are in `PRIVATE-RELEASE.md`.
- Container deployment, real-corpus-only evaluation, and submission documentation now exist.
  Remaining work is external evidence: real credentials/current feed, confirmed proof tx,
  multi-fixture evaluation, private staging, and a judge-accessible deployment after the
  competition ends and the owner authorizes publication. See `REMAINING.md`.

**Ownership (PRD):** Daniel — daemon core, Latency Radar, replay, grade sheet ·
Tim — risk framework, exec integration, dashboard, narrative/demo.
Lanes are marked inline as `[LANE: Daniel]` / `[LANE: Tim]` / `[LANE: shared]`.

---

## TL;DR

All product phases now have a real vertical slice. **120 tests are green**; lint and all packages
typecheck; `replay(corpus) === ledger` is asserted in CI. The T1 gate failed because no
on-chain intent-book exists and was resolved by decision **D-001**: live quote publication,
real `validate_odds` verification, and matching simulation isolated to explicit replay.
Read `GROUND-TRUTH.md`, `REMAINING.md`, and `RUNBOOK.md`. Entry points are `pnpm run ci`,
`pnpm daemon`, `pnpm replay`, and `pnpm evaluate:real`.

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
| 8 Dashboard | ✅ connected | Next 16 dashboard reads only the daemon evidence API; live SSE refresh, loading/error/waiting states, proof evidence, no mock adapter |
| 9 Replay lab | ✅ done | replayCli (multi-speed); determinism confirmed; feed-gap chaos drill; simulation explicit and isolated |
| + Analyst layer | ✅ done | `apps/analyst`: read-only MCP (3 tools) + Groq→DGrid LLM + agent; dashboard "Ask Tissue"; 14 tests. **Additive, read-only, never near the decision path** |

---

## Key decisions

### D-001 — Execution model: quote publication + replay-only matching
The sponsor devnet program has **no intent-book** (`create_intent`/`execute_match`/
`claim_via_resolution`/`settle_matched_trade` do not exist; verified against commit
`f37473a`). Rather than design exec on a guessed interface, `exec/` is a **port**:

- **Anchoring is real.** Each live odds input fetches its proof and calls the real
  `validate_odds` instruction via RPC view; transaction mode records only a confirmed
  signature. Failed or unavailable proof checks remain failed evidence.
- **Score authority is real.** Each sequenced score update proves the four cumulative stats
  used by the engine through `validate_stat`; no unproved score enters the corpus or state.
- **Live output is quote publication.** Approved quotes are published through the daemon API;
  no fill exists unless a future venue acknowledges it. No live PnL is synthesized.
- **Replay matching is isolated.** The deterministic simulated book remains available only
  under explicit replay mode for research and failure tests.
- **Swap-in boundary.** The `exec/` interface is designed so a future real permissionless
  orderbook (sponsor: "in preparation") drops in behind the same port, not a rewrite.

This preserves fill-independence: CLV grades every published quote against the close without
requiring a fictional fill. Full detail + evidence are in `GROUND-TRUTH.md` and `feedback.md`.

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
Pricing inputs and proof verification use one explicitly configured network at a time.
JWT origin, credentials, RPC, and program ID must agree. The daemon does not silently
cross networks or fall back from mainnet to devnet.

---

### D-009 — Frontend finishing pass (design system + landing page)
Applied `internal/design.md` + `designtips.md` ("Visitors" white engineering blueprint) as one
token set (CSS custom properties in `apps/dashboard/app/globals.css`): Carbon text, single
Lavender `#918df6` accent, hairline Fog borders, pill controls, and a system sans-serif stack
(OpenRunde's named fallback). Status colors are functional, not chrome: Amber = caution/SIM/halt,
Mint = positive/chain-ok, Ember = danger/broken. Routing split into a `(marketing)` group (real
landing at `/`, 8 sections, real build numbers) and an `(app)` group (the dashboard: overview,
quotes, radar, decisions, grade, replay, analyst) with its own nav+footer. The mock data seam and
non-functional replay controls were removed; every product route now reads the live daemon
evidence boundary. Copy follows the PRD's instrument-calm voice with zero em
dashes and none of the banned phrasing.

### D-008 — E2E failure-path hardening (3 real bugs found + fixed)
Probing PRD §3 failure branches E2E surfaced three real bugs, now fixed + tested
(`replay/failures.test.ts`, 6 E2E tests):
1. **Abandoned/cancelled match** settled PnL on a phantom score. Fixed: `isVoid` flows
   score→engine; a void match HALTs, cancels all, and books ZERO PnL (never settles on score).
2. **VAR score reversal** fired a FALSE unexplained-movement HALT (Radar ignored score
   decreases). Fixed: a score decrease is now a `score_correction` event that explains the move.
3. **Fee ladder was orphaned** (unit-only). Fixed: exec now routes posts through a fault hook —
   `submitFault` "congested" escalates the fee ladder → market halt on exhaustion; "failed"
   → market halt after `tx_max_retries`. Also fixed: the engine now flushes the Radar at end
   (the last reaction was being silently dropped).
E2E-covered failure paths: feed-gap HALT, unexplained HALT, drawdown-kill (recovery),
model-divergence pull+flag, abandoned-void, VAR-reversal, tx-failure, congestion, tamper.

### D-007 — Analyst layer: read-only narration, isolated from decisioning
`apps/analyst` is an ADDITIVE presentation layer over already-hash-chained ledger/grader
outputs. It cannot touch `policy.toml`, `risk/`, `exec/`, or ledger writes — enforced by
construction: the decision path writes a benign `*.analyst.json` export; the isolated analyst
service atomically materializes `corpus/analyst.db`, and its MCP tools open SQLite
**read-only** (`{ readOnly: true }`),
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
(finalized signature `qx7A7wmYnTfffUUxzvLu5fFk9eM34LzZXvfw9mDbbBJpkmjfgqYKX3gNMBve3iNzsNThnBiJWuzhbgxLBssHuDX`,
48,616 CU) → `/token/activate` → real `X-Api-Token`. Real corpus `corpus/18209181.jsonl`
(FRA 2-0 MAR, 40 real scores + 43 real O/U odds) seeded via `apps/daemon/scripts/liveActivate.ts`.
The credential and captured corpus were intentionally not committed; a clean checkout must
receive a current credential file through `TXLINE_CREDENTIALS_PATH`. Findings are in
feedback.md F-002. De-vig is validated against a protocol-valid captured StablePrice row.

## Open questions
- [x] **Free tier has no 1X2 market.** Totals-only bootstrap now prices and quotes the actual
      free-tier O/U bundle without synthesizing a 1X2 market.
- [ ] Real orderbook IDL + `/api/trading/*` endpoints from sponsor (F-001) — swap into
      `exec/` when published.
- [ ] Record current `validate_odds` view/transaction evidence and CU cost with renewed
      credentials; the clean checkout contains no publisher token or signing key.

## Next
The non-video product path is built. Remaining evidence gates are listed in `REMAINING.md`:
current real SSE capture, proof evidence, multi-fixture evaluation, private staging, and a
judge-accessible deployment only after the competition ends and publication is authorized.
