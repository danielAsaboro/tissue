# TISSUE — HANDOFF

Living state doc. Updated at every phase boundary. If you are picking this repo up,
read this top-to-bottom, then `GROUND-TRUTH.md`, then `internal/tissue-prd.md` (the spec).

**FullTime creates the conversation. Slip turns it into an agreement. Tissue finds the fair price and trades it across supported markets.**

Tissue currently prices 1X2 and totals. Its new generic venue boundary covers normalized
discovery/identity, fair-value and fee/liquidity economics, capital policy, signed submission,
confirmation/reconciliation, settlement/claim, and durable evidence. Only the real Slip
adapter is registered. Polymarket and other order books are future adapters, not completed or
exposed integrations.

## 2026-07-19 hardened Slip public-devnet migration

- Tissue now consumes Slip's hardened unified ABI and public devnet program
  `7gNEnFMDVhxFLSrtSctaPPCX7RcPbz1Lu5vtxvzobXFt` instead of the older `8VNZ...` build.
  Exact SBF, IDL, packed-SDK, base-commit, deployment-signature, and compatibility-patch
  hashes are recorded under `vendor/*.provenance.json`.
- A read-only public-devnet check through Tissue's packed consumer returned
  `unifiedMarkets: true` and decoded five real markets at settlement mint `9GGUMX...Rnj`.
  Observed examples were `2NNZXs...cwr3` (fixture 18209181, voided),
  `42JSkL...W5Fz` (fixture 18257739, open), and `B8C7cf...gZn5`
  (fixture 18209181, voided).
- The exact hardened SBF passed Tissue's real Surfpool execution lifecycle: independent
  two-sided provisioning, signed `buyTicket`, protocol-valid TxLINE proof resolution, token
  payout, and retry reconciliation. Tissue removed the obsolete race/`Proposed` decoder
  workaround, exposes Slip's resolution-evidence commitment, and gives `void_at` precedence
  over delayed terminal proofs.
- The migration exposed a packed-SDK defect masked by Slip's Vite tests: Node ESM could not
  load Codama's extensionless generated barrels. The sibling Slip workspace now fixes
  generated specifiers after Codama runs and before every build, and verifies the built
  entrypoint with Node. That Slip patch remains an uncommitted visible change and must be
  committed before publishing a new SDK artifact.
- The Surfpool lifecycle now enters through `SlipVenueAdapter` and the shared
  `executeThroughVenue` stages rather than calling the Slip executor directly. Runtime state,
  append-only journaling, API records, and dashboard rows use venue-neutral identifiers while
  preserving the retired Slip journal as read-only migration evidence.
- Final verification on 2026-07-19: `pnpm test` passed 364 tests (10 explicitly gated),
  `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm verify:runtime`, and deterministic
  `pnpm --filter @tissue/daemon replay` passed. The opt-in real lifecycle command
  `pnpm --filter @tissue/daemon test:slip:surfpool` passed 1/1 against the pinned SBF.
  A fresh credential-free public-devnet consumer run again returned
  `unifiedMarkets: true` and five decoded markets. A Tissue-funded public-devnet write was
  not attempted because no owner-authorized funded keypair was supplied.

## 2026-07-19 adversarial execution and production hardening

- Recovered the workspace's real TxLINE research corpus at
  `../resources/fixtures/world-cup-2026` instead of incorrectly treating the project-local
  `corpus/` directory as the whole evidence universe. Added a local authenticated replay
  service that verifies every served file's SHA-256/byte length and feeds captured HTTP/SSE
  bytes through the production snapshot fetchers and normalizers.
- The archive exposed four live-normalization defects now fixed: real 1X2 selections are
  `part1/draw/part2`; match minute comes from `Clock.Seconds`; pressure ownership is a
  top-level `Participant`; and action `Id` repeats across amendments while delivery `Seq`
  is unique. The old adapter discarded odds, mis-timed events, assigned away pressure to
  home, and deduplicated amended events.
- The corrected deterministic evaluation covers 100 completed fixtures, 109,382 normalized
  messages, and 7,192 graded quotes. Weighted CLV is +225bps on both the fixed 61-fixture
  calibration set and 39-fixture holdout. Holdout Brier improves on the opening-market
  baseline (0.197298 vs 0.220753); calibration Brier regresses (0.174960 vs 0.161049), so
  the evidence is promising but not represented as uniform calibration superiority.

- Corrected exchange risk economics: Kelly's LAY output is liability, not displayed backer
  volume; lay maximum loss is now used by every cap, and filled unresolved positions remain
  in exposure instead of freeing the same limit for reuse. Each ledger intent now carries
  its own Tissue probability and edge rather than borrowing an unrelated record-level top edge.
- Slip rejects LAY intents instead of buying the opposite economic position, accumulates
  existing stake in per-market caps, and requires a positive edge over the exact post-stake,
  post-fee pari-mutuel break-even probability. Mainnet is refused because Slip's current
  `buyTicket` instruction has no atomic minimum-payout/slippage guard; localnet/devnet evidence
  remains real, but unprotected mainnet capital is not presented as production-safe.
- Fixed a 1,000,000x real-capital sizing bug: policy stake units are now explicitly the
  settlement mint's atomic units and are passed to Slip as raw `bigint`, never reparsed as
  human token text.
- Slip execution now derives the exact market PDA from fixture + market + totals line,
  verifies its full rulebook, and refuses missing or one-sided pools. It no longer creates
  an empty market and immediately buys its own sole side (which Slip correctly voids).
- Added restart-safe resolve/claim and void/refund reconciliation. It fetches the two final
  TxLINE stat proofs, submits real instructions, polls canonical account state at the
  confirmed context slot, verifies the ticket was actually claimed, and journals every
  lifecycle transition. The dashboard exposes buy/resolve/claim/void/refund signatures.
- The real Surfpool gate now proves an independently provisioned/two-sided market, exact
  2,000,000-atomic-unit Tissue stake, TxLINE-proof resolution, payout, and idempotent rerun.
- Corrected the opening model: it accumulates both pre-match streams independent of arrival
  order and freezes/commits only when play begins. Feed-gap and proof-rate kills now cancel
  open intents immediately and remain latched until operator restart. Proof verification is
  ordered per fixture but concurrent across unrelated fixtures, with a bounded overload kill.
- `/health` now returns 503 when unhealthy; daemon container readiness uses `/ready`.
  Docker build contexts now contain `packages/slip` and the required vendored artifacts.
- Clean Docker builds exposed three more missing inputs: the patched-dependency file,
  `.npmrc` lockfile settings, and the analyst's Slip workspace source. All three images now
  build from scratch and `pnpm verify:containers` passes their non-root/runtime/header and
  fail-closed configuration checks.
- Mitigated unpatched `GHSA-3gc7-fjrx-p6mg` by forcing `bigint-buffer` onto its memory-safe
  JavaScript implementation via `patchedDependencies`; the single audit exception is explicit
  and documented in `SECURITY.md`.
- The synthetic stress replay still loses −183,548,499 simulated atomic units after corrected
  liability accounting; it remains a deterministic failure-path fixture, not evidence of
  strategy quality. Real strategy evidence is the separately labelled, no-fabricated-fill
  historical evaluation in `.superstack/world-cup-evaluation.json`.

## 2026-07-15 AI SDK 7 and CI compatibility update

- The production analyst model boundary now uses `ai@7.0.28` with the official
  `@ai-sdk/openai-compatible@3.0.11` provider for Groq and DGrid. AI SDK owns provider protocol
  normalization and first-class total/per-step timeouts; the real in-memory MCP client/server bridge
  still executes every read-only tool, and provider fallback remains visible in API metadata/metrics.
- The existing two-mebibyte provider response cap is preserved through the provider's custom fetch
  boundary. No model, tool result, or provider success is mocked in production.
- npm retired the audit endpoints used by pnpm 10.33 on July 15. Both local CI and GitHub CI now use
  pnpm's documented `--ignore-registry-errors` option. Real moderate-or-higher advisories still fail;
  only registry transport failure is non-blocking so the remaining verification matrix still runs.
- Focused analyst typecheck and tests pass: 17 passed and the explicitly external live-model test
  remained skipped because no model endpoint was configured.
- The first compiled-runtime run exposed AI SDK's optional Vercel OIDC CommonJS dependency inside
  the standalone ESM bundle. The analyst build now injects Node's real `createRequire` into
  esbuild's compatibility shim. `pnpm run ci` then passed end to end: lint, all typechecks, 126
  deterministic tests, daemon/analyst/dashboard builds, compiled runtime health, and deterministic
  replay. The audit endpoint still reports HTTP 410, as expected, before the remaining checks run.

## 2026-07-18 Edge-case hardening + four novel pricing/risk regimes

Closed real gaps found by an adversarial audit of the decision path, then shipped four new
signals layered onto the existing pricing/strategy core. **All additive**: existing tests
untouched, `replay(corpus) === ledger` still holds, 126 → 203 tests.

Edge-case fixes:
- ET/penalties pricing no longer zeroes remaining goal-scoring lambda at minute 90; added a
  discretionary-stoppage-time regime (`model.stoppage`) that floors remaining-time fraction
  instead of hard-zeroing and applies a bounded lambda boost (`tissue/inplay.ts`).
- `exec/simulatedBook.ts` now settles a push (total lands exactly on an integer line) as a
  stake refund instead of a loss for both BACK and LAY.
- `config/policy.ts::validatePolicy` is now an exhaustive recursive shape-check against every
  policy.toml field, not a handpicked 6-field subset — a missing field now fails loudly at
  boot instead of silently disabling a risk gate via `NaN > x`. `risk/gates.ts` and
  `config/policy.ts` went from zero test coverage to full coverage.
- Added a portfolio-level exposure cap + drawdown kill across every concurrently running
  fixture (`policy.risk.portfolio_*`, `EngineSession.kill()`, `runtime/liveDesk.ts`).
- Cross-stream (scores/odds) clock skew is now detected and recorded (`EngineResult.clockSkewEvents`)
  instead of silently clamped to "fresh."
- Historical notes previously claimed a genuine mainnet corpus for fixture `17588302`, but
  that corpus is absent from the checked-out repository and therefore is not reproducible
  evidence. `captureCorpus.ts` remains the real capture boundary; `evaluate:real` correctly
  fails until independently verifiable real messages are captured again.

Four new signals (all policy-driven, all with dedicated tests):
- **Mutual-danger regime** (`state/matchState.ts`, `model.mutual_danger`): sustained
  simultaneous high-pressure on both sides widens spread and cuts size — the next-goal
  distribution is bimodal there, not the Poisson point estimate's confident middle.
- **Path-dependent narrative regime** (`radar/narrative.ts`, `radar.narrative`): a rolling
  window of Radar signal classes classifies the market's persistent behavior (compounding /
  cautious / oscillating), sized independently of the last single event.
- **Consensus-based informed-flow signal** (`radar/informedFlow.ts`, `radar.informed_flow`):
  the honest single-stream adaptation of a cross-book VPIN idea that TxLINE's real feed can't
  support (StablePrice is one de-margined consensus, confirmed against current live docs, not
  per-book lines) — classifies a move's velocity against the market's own trailing
  distribution instead of one fixed magnitude threshold for every market.
- **Stale-quote decay** (`strategy/staleQuote.ts`, `strategy.stale_quote`): the honest
  adaptation of a "dead intent decay" idea that needs an external orderbook TxLINE doesn't
  have (D-001) — tracks the age of Tissue's OWN resting quote and compresses spread as it
  ages unchallenged.
- **Pre-Match Hash Commitment ("Proof of Edge")** (`exec/preMatchCommit.ts`): hashes the
  desk's first priced-markets snapshot, before any score message, and anchors it via a real
  SPL Memo transaction (the sponsor program has no generic commitment instruction — this uses
  Solana's standard timestamping primitive instead). Real confirmed devnet evidence: signature
  `5vSVJU2QaGmBhEcyngA6fnzyToSBjLNnN1Vq4YutXR4JTkaPg2BUVpPoPutvwkmYgKbuKGcUetXeLytkgrHvvmsm`,
  slot `477055999`. See `REMAINING.md`.
- **Strategy Arena** (`apps/daemon/src/arena/`, sponsor's "Agent vs Agent Arena" idea):
  the SAME feed through the SAME deterministic engine twice — Tissue (every regime
  enabled) vs a neutralized Baseline (`baselinePolicy`, every flagged heuristic/regime
  reduced to a no-op, correctness fixes like the stoppage zero-lambda fix left on for
  both) — graded head-to-head with the same CLV/Brier grader. Reuses the existing
  engine/ledger/grader entirely; no second unvalidated pricing model invented. Exposed
  on-demand via daemon `GET /arena[?fixtureId=]` (computed fresh from the fixture's
  authoritative corpus, not a second continuously-running live session) and on the
  dashboard's new `/arena` page. Also printed by `pnpm run replay`.

**UI parity closed (same day):** the four regimes above run on every live/replay decision
and were recorded in the hash-chained ledger, but were invisible in the dashboard UI —
closed: Radar page's signal-class legend now lists `informed-flow`; the Decision feed has a
new "Regime" column rendering compact badges (ET/PEN phase, STOPPAGE, MUTUAL DANGER,
narrative regime) only when non-default; `HaltBanner`'s explanatory copy is now
reason-specific (`informed-flow`, `feed-gap`, `drawdown-kill`, `model-divergence`,
`match-void`) instead of one generic "unexplained movement" paragraph covering every halt.
Verified by rendering real + hand-built regime fixtures through the actual components in a
real browser (screenshot-checked), not just typechecked.

## 2026-07-14 Slip SDK agent update

- Tissue now installs the same packed `@slip/sdk@0.2.0` public contract as FullTime. The tarball
  is local to `vendor/`; provenance records Slip's base commit, complete staged SDK patch hash,
  tarball SHA-512, and npm integrity. Tissue has no FullTime dependency or room contract.
- `@tissue/slip` is the generic automated-consumer boundary. It uses the SDK's capability check,
  canonical readers, reference verifier, WebSocket watcher, wallet-ticket reader, bigint market
  math, and real buy/claim/refund/resolve/void instruction builders. It never signs by itself.
- The analyst now has three explicit skills: `ledger-forensics`, `slip-market-intelligence`, and
  `slip-settlement-audit`. Seven MCP tools expose three immutable-ledger reads and four verified
  Slip reads. No transaction, trade, post, policy-write, or signer tool is registered.
- Slip implied probability is always labeled as pool-derived participation weight. It is advisory
  evidence beside Tissue's independent price and cannot replace TxLINE proof settlement.
- A protocol-valid local JSON-RPC fixture exercises the packed SDK's account codec, program
  capability detection, PDA/owner/mint checks, bigint projections, and real buy-instruction
  construction. A read-only July 14, 2026 check through Tissue's installed tarball returned
  `{"network":"devnet","unifiedMarkets":false}` for the program published at that time. This is
  historical evidence, superseded by the hardened July 19 deployment/read result at the top
  of this document; it is not the present capability state.
- The live agent path is also verified, not only scripted: `qwen3.6:35b-mlx` on the MBP used the
  `inspect_slip_market` MCP tool, crossed the protocol-valid local RPC boundary through the packed
  refreshed packed SDK, and returned the grounded leading outcome, 5,000 bps pool weight, and
  4.965 projected payout. `agent.live.integration.test.ts` passed again in 32.6 seconds after the
  final SDK repack. It is a separately gated command because
  a clean checkout has no right to assume that LAN model exists.

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

## Tim — dashboard / marketing surface (2026-07-16)

- Marketing landing rebuilt to FullTime-style story frames: desk hero, product
  overview mock, radar moment strip, closing desk; compressed JPEGs under
  `apps/dashboard/public/images/`; Open Graph at `og.jpg`.
- Desk overview: proof-surface strip (independent price, radar halt, replay===ledger,
  no fake fills) above Tissue-vs-market chart.
- HaltBanner: stronger halted/unexplained-movement operator copy.
- Radar page: full signal-class legend including unexplained-movement → halt.
- Live credentials, validate_odds tx evidence, multi-fixture evaluate:real, and
  public deploy remain external (see REMAINING.md).

---

## TL;DR

All product phases now have a real vertical slice. The current default matrix has **364 tests
green** (3 Slip + 309 daemon + 39 analyst + 13 dashboard), with 10 explicitly gated external
or local-chain cases; Chromium E2E adds 20 passing cases. Lint and all packages typecheck;
`replay(corpus) === ledger` is asserted in CI. The T1 gate failed because no
on-chain intent-book exists and was resolved by decision **D-001**: live quote publication,
real `validate_odds` verification, and matching simulation isolated to explicit replay.
Read `GROUND-TRUTH.md`, `REMAINING.md`, and `RUNBOOK.md`. Entry points are `pnpm run ci`,
`pnpm daemon`, `pnpm replay`, `pnpm evaluate:real`, and `pnpm evaluate:fixtures -- --all`.

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
| + Analyst layer | ✅ done | `apps/analyst`: 3 constrained skills, 7 read-only MCP tools, Groq→DGrid LLM + agent; dashboard "Ask Tissue". **Additive, read-only, never near the decision path** |
| + Slip consumer | ✅ local contract | Packed SDK readers/watchers/math/action builders plus analyst market tools. Public devnet use stays gated until the unified binary is detected. |
| + Slip execution | ⚠️ localnet/devnet only | `exec/slipExec.ts`: BACK-only, exact post-stake venue economics, cumulative exposure caps, and full lifecycle proven against the real program on Surfpool. Mainnet is refused until Slip supplies atomic minimum-payout protection — see D-010. |

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
- **Venue boundary.** `exec/venue.ts` now carries real normalized discovery, economics,
  authorization, signing, reconciliation, settlement, and evidence. Slip is its only enabled
  adapter; a future permissionless order book must implement this full boundary before it is
  registered or exposed.

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
three ledger reads plus four packed-SDK market reads over MCP. The skills constrain how those
tools are combined: ledger facts require citations; Slip pool weights are never called Tissue
fair value; references must verify before their state is trusted. The loop is driven by an LLM
(Groq primary → DGrid fallback, per-query provider logged) through a real in-memory MCP
client↔server connection. Surface: dashboard `/analyst` ("Ask Tissue")
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

### D-010 — Real order execution lands on Slip, not TxLINE's own program
The sponsor devnet program still has no order/execution instruction of any kind (D-001
stands, unchanged) — that question was never TxLINE's to resolve. Real execution instead
lands on Slip, a separate real settlement venue Tissue already vendors a consumer for
(`packages/slip`, previously analyst-read-only-only). `exec/slipExec.ts` maps a
risk-approved decision to a real Slip market/outcome band, checks it against a second,
stricter, off-by-default capital-risk gate (`risk/gates.ts::evaluateSlipExecution` — its
own edge threshold and exposure caps, layered on top of the existing quote-publication
gate, not a replacement for it), then signs and submits a real `buyTicket` transaction
with the same keypair used for on-chain anchoring on localnet/devnet. It refuses LAY
inversion, applies exact post-stake venue-edge checks, and disables mainnet because the
current instruction has no atomic minimum-payout guard. Found and fixed a real bug along the
way: the vendored `@slip/sdk` tarball had been packed before Slip's `settlement_mode`
field was added to `MarketExpression` on both the Rust program and the SDK's own
committed codegen — the stale packed encoder silently omitted the field, corrupting
every transaction built through it (Anchor error 102, `InstructionDidNotDeserialize`).
That first issue needed no Slip source change; it was fixed by rebuilding and repacking the
then-current source. The later hardened migration did require the Node ESM packaging fix
documented at the top of this handoff. Rehearsed the full lifecycle — independently provision a
two-sided market, buy, resolve from a protocol-valid constructed score proof, claim, and
retry reconciliation, each step independently verified
on-chain — against a local Surfpool instance running the real compiled Slip program
(`apps/daemon/src/exec/slipExec.surfpool.test.ts`,
`pnpm --filter @tissue/daemon test:slip:surfpool`). Evidence surfaces on `/state`,
`/record`, and the dashboard's `/decisions` page. The packed reader/capability boundary is
also verified against the real public devnet deployment; no additional owner-funded write
was submitted from Tissue. Mainnet production-capital use remains blocked on atomic venue
slippage protection.

## Open questions
- [x] **Free tier has no 1X2 market.** Totals-only bootstrap now prices and quotes the actual
      free-tier O/U bundle without synthesizing a 1X2 market.
- [x] **Real order execution.** Resolved via Slip, not the sponsor's own program — see D-010.
- [ ] Real orderbook IDL + `/api/trading/*` endpoints from sponsor (F-001) — TxLINE's own
      program still has none; would swap into `exec/` alongside Slip if ever published.
- [ ] Record current `validate_odds` view/transaction evidence and CU cost with renewed
      credentials; the clean checkout contains no publisher token or signing key.

## Next
The non-video product path is built. Remaining evidence gates are listed in `REMAINING.md`:
current real SSE capture, proof evidence, multi-fixture evaluation, private staging, and a
judge-accessible deployment only after the competition ends and publication is authorized.
