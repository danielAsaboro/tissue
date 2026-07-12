# TISSUE — HANDOFF

Living state doc. Updated at every phase boundary. If you are picking this repo up,
read this top-to-bottom, then `GROUND-TRUTH.md`, then `internal/tissue-prd.md` (the spec).

**Ownership (PRD):** Daniel — daemon core, Latency Radar, replay, grade sheet ·
Tim — risk framework, exec integration, dashboard, narrative/demo.
Lanes are marked inline as `[LANE: Daniel]` / `[LANE: Tim]` / `[LANE: shared]`.

---

## Current state

| Phase | Status | Notes |
|------|--------|-------|
| 0 Scaffold | ✅ done | monorepo, policy.toml, env, docs, dashboard data seam |
| 1 TxLINE spine | ⏳ | auth chain + dual SSE + corpus recorder |
| 2 Ground truth | ⏳ | GROUND-TRUTH.md — exec reality documented (see below) |
| 3 Tissue core | ⏳ | pure pricing jewel |
| 4 Latency Radar | ⏳ | scaffold — `[LANE: Daniel]` calibration |
| 5 Risk + Strategy | ⏳ | `[LANE: Tim]` |
| 6 Exec | ⏳ | port + simulated book + real anchoring |
| 7 Ledger + Grader | ⏳ | hash chain + replay-equality CI |
| 8 Dashboard | ⏳ | headless on mock seam |
| 9 Replay lab | ⏳ | determinism confirm + REMAINING.md |

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

## Open questions
- [ ] Real orderbook IDL + `/api/trading/*` endpoints from sponsor (F-001) — swap into
      `exec/` when published.
- [ ] Completed World Cup fixture id for corpus seed (Phase 1) — pending schedule lookup.
- [ ] `validate_odds` return semantics (bool data vs revert-on-false) + CU cost — T3.

## Next
Phase 1 — TxLINE auth chain + dual SSE clients + corpus recorder.
