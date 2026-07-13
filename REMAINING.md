# REMAINING — work split by lane

Everything in `internal/tissue-prd.md` has a first, tested pass in place (69 tests green,
`replay(corpus) === ledger` asserted). What's left is calibration, live wiring, and the
design/narrative pass. Split by PRD ownership so each owner can pick up cleanly.

---

## [LANE: Daniel] — daemon core · Latency Radar · replay · grade sheet

- **Radar threshold calibration (T5).** `policy.toml [radar]` seeds (`significant_reaction_bps`,
  `unexplained_bps`, latency bands per class, `overreaction_retrace_pct`, draw-compression)
  are first-pass. Recalibrate against corpus #1 once live fixtures are recorded. Consider a
  short post-reaction cooldown so late settling isn't re-flagged.
- **Signal taxonomy redesign.** `favorite-panic` uses a placeholder threshold
  (`significant_reaction_bps × 2`); `draw-compression` and `stale-line` want real triggers.
  The class set itself is yours to redesign (`radar/classify.ts` is the one file to touch).
- **Reaction stabilization.** `radar.ts` finalizes at window close; a proper stabilization
  detector (rate < `stabilization_rate_bps_per_sec` held for `stabilization_hold_ms`) is
  stubbed in policy but not yet wired into the finalize path.
- **Replay polish.** `replay/replayCli.ts` narrates the tape; add scrub/pause and per-decision
  drill-down for the demo. Determinism is already CI-guaranteed.
- **Grade-sheet presentation.** `grader/` computes CLV / Brier+calibration / latency /
  per-class hit rates. Brier calibration is degenerate on a single synthetic match
  (`resolution 0`) — meaningful once multiple real fixtures accumulate.

## [LANE: Tim] — risk framework · exec integration · dashboard · narrative

- **Dashboard design pass.** `apps/dashboard` is a headless skeleton on the mock seam
  (`lib/data/`). Apply the cockpit aesthetic (PRD §10): artificial-horizon inventory, fuel
  exposure, master-caution halt. Swap `mockDashboardData` for a live adapter over the
  daemon's ledger JSONL / flight recorder — the `DashboardData` interface already fits.
- **Narrative / demo cut.** Drive the ≤5:00 screenplay (PRD §6) off `pnpm replay --speed=N`.
  The unexplained-movement HALT beat and the hash-chain verify button are both wired.
- **Risk tuning.** Caps, `kelly_fraction`, `gamma_inventory`, `model_divergence_band_bps`,
  `drawdown_kill` are sane defaults — tune against real PnL/exposure once live.
- **Crash recovery (PRD §5).** Snapshot + updates-search rebuild, chain reconcile,
  resume-or-halt per policy is designed but not implemented; the ledger + `verifyChain`
  give the reconcile primitive.

## [LANE: shared] — open items

- **Live SSE capture.** `ingest/sseClient.ts` + `txlineAuth.ts` are complete and faithful
  to the sponsor scripts, but the `subscribe` CPI + `/token/activate` need a funded devnet
  wallet (`TISSUE_KEYPAIR_PATH`) to produce a real `X-Api-Token`. Then record live
  QF/SF/Final corpora (`seedCorpus.ts` already has the snapshot path).
- **Mainnet realtime (level 12).** Needs real SOL for activation (PRD network split). Fall
  back to devnet-only pricing if rejected (already handled in design).
- **Real `validate_odds` submission.** `exec/anchor.ts` derives the PDA and prepares the CPI
  deterministically; live submission awaits (a) confirming the `daily_odds_merkle_roots` vs
  `daily_batch_roots` seed on-chain, and (b) the odds-proof REST endpoint (GROUND-TRUTH T3).
- **Real orderbook swap-in.** When the sponsor ships the "in preparation" permissionless
  orderbook (feedback.md F-001), implement `ExecPort` against it — the simulated book is the
  drop-in reference. Nothing else changes.
- **Dashboard runtime imports of `@tissue/shared`.** Type-only imports work; runtime helper
  imports need a compiled `dist` (JS + `.d.ts`) or a Turbopack extension-alias. Add a build
  step to `packages/shared` before the live adapter uses its runtime exports.
- **Corners/cards markets.** Flip on via `policy.toml markets_enabled` once the corpus
  supports them (encodings already in `soccerFeed.ts`).
