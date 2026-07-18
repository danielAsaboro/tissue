# TxLINE API feedback — friction log

Logged from minute one (scored submission component, PRD §9). Each entry: what we
tried, what we expected, what happened, and the workaround. Newest first.

---

## F-004 — Real process-level restart drill (REMAINING.md item 5): mainnet IDL mismatch, empty proof-fetch errors for older messages, devnet RPC rate limiting
**Phase:** production-readiness drill · **Severity:** blocks a fully successful live run, does not block the code · **Date:** 2026-07-18

Built `apps/daemon/scripts/restartDrill.mjs` + `restartDrillRelay.mjs`: spawns the COMPILED
daemon as a real OS process, feeds it a real captured fixture's messages through a local
relay (SSE transport replay only — every proof-validation/JWT call proxies straight through
to the REAL TxLINE origin with real, already-activated credentials), SIGKILLs it mid-stream,
restarts the same binary, and asserts the persisted hash chain survived. Three real findings
from running it against actual TxLINE/Solana endpoints:

1. **The bundled IDL (`apps/daemon/idls/txoracle.json`) is devnet-specific.** Running with
   `TISSUE_NETWORK=mainnet` and mainnet credentials fails every `validate_odds` view call
   with `IDL program 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J does not match configured
   TxLINE program` — the IDL declares the devnet program address regardless of which network
   `anchorLive.ts` is configured for. A mainnet run needs a mainnet-flavored IDL (same
   instruction set, different declared address) or an IDL that omits/parameterizes the
   address.
2. **`/api/odds/validation` and `/api/scores/stat-validation` returned proof lookups that
   failed with an EMPTY error message** (`error instanceof Error ? error.message : ...`
   evaluated to `""`) for a subset of a completed fixture's older messages, even though the
   same fixture's snapshot data fetches fine. Root cause not yet isolated — could be a proof
   retention window on TxLINE's side for older/completed fixtures, or a malformed/empty
   response body our parser doesn't surface a message for. Needs a currently-live match (or
   sponsor clarification) to confirm which.
3. **Public devnet RPC (`api.devnet.solana.com`) 429-rate-limited** under the anchoring call
   volume this drill generates (one `getAccountInfo` + one Anchor `.view()` per admitted
   message). A live desk needs a dedicated/paid RPC endpoint, not the public default, once
   quoting genuinely picks up pace.

**Impact:** the drill's process-level mechanics (real spawn, real health check, real SIGKILL,
real restart, real `/verify` hash-chain check) are built and exercised — the orchestrator ran
end-to-end and correctly reported real proof-verification failures rather than faking
success. A fully successful run (real proof-verified admission → kill → restart →
continuation) needs either a currently-live match or the mainnet IDL / proof-freshness issues
above resolved. The in-process recovery logic itself (`assertPersistedLedgerPrefix`,
`reconcilePersistedLedger`) already has full unit/integration coverage
(`replay/failures.test.ts`, `state/recovery.test.ts`, `runtime/liveDesk.test.ts`) — this drill
adds the missing real-process layer, not a replacement for it.

**Ask to sponsor:** publish a mainnet-address IDL variant (or confirm the devnet IDL's
instruction set is address-agnostic and safe to use with an override), and clarify whether
`validate_odds`/`validate_stat` proof responses are retained indefinitely for completed
fixtures or expire after some window.

---

## F-003 — Odds validation endpoint is now published and usable
**Phase:** live verification · **Severity:** resolved blocker · **Date:** 2026-07-13

The current hosted API reference now documents:

`GET /api/odds/validation?messageId={messageId}&ts={ts}`

with JWT + `X-Api-Token`, returning `odds`, `summary`, `subTreeProof`, and `mainTreeProof`.
This resolves the earlier T3 uncertainty. Tissue now validates response message identity,
decodes every proof hash to exactly 32 bytes, derives/checks the daily root PDA and owner,
executes `validate_odds` through a real RPC view, and can submit a confirmed transaction.

Remaining documentation friction: the API response schema renders the proof arrays as a
`Nil | ProofNode[]` union, and the account name (`daily_odds_merkle_roots`) still differs from
the documented/root insertion seed terminology (`daily_batch_roots`). Tissue fails precisely
if the derived account is absent or owned by another program rather than guessing success.

---

## F-001 — On-chain intent-book / trade-suite instructions are not in the current devnet IDL
**Phase:** 2 (execution ground truth) · **Severity:** high (blocks the assumed exec design) · **Date:** 2026-07-13

Our earlier project research assumed an on-chain intent-book with instructions
`create_intent → execute_match → claim_via_resolution / settle_matched_trade` and an
`OrderIntent.odds: u16` field. We checked the sponsor repo at commit `f37473a`
(`Schedule update`, 2026-07-12) and found:

- **None of those instructions exist** in any of the three vendored IDLs (root, devnet
  `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, mainnet
  `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`). The on-chain `txoracle` program is a
  data-oracle + subscription + validation program: `subscribe`,
  `purchase_subscription_token_usdt`, `insert_{batch,fixtures,scores}_root`,
  `validate_odds`, `validate_stat[_v2/_v3]`, `validate_fixture[_batch]`,
  `{initialize,update,close}_pricing_matrix`, treasury init/withdraw. No matching,
  escrow, or settlement instruction.
- The **README's Offer/Trade flow is prediction-based binary options on US-Football /
  basketball stats** (e.g. "Team A score > 11 by HT"), brokered **off-chain**
  (`/trading/stream` `NewOffer`), settled by score proofs — *not* soccer 1X2/totals
  two-sided market-making, and different in kind from what we price.
- The README's own settlement instruction reference is stale: it says "`settleTrade` is
  available in the Devnet IDL" (README ~line 113), **but no `settleTrade` instruction is
  present** in the vendored devnet IDL.
- The README states a **non-custodial orderbook trading model "is in preparation"**
  (~line 35), and the `/api/trading/*` REST endpoints are "illustrative until trading
  endpoints are published."
- **Odds encoding:** README `Offer.odds` is **decimal × 1000** (`odds: 2000` = 2.0), not
  the decimal × 100 our research assumed.

**Impact / how we handled it:** we did not design execution on a guessed interface.
`exec/` is built as a port: provenance anchoring uses the **real, callable-today**
`validate_odds` / `validate_stat` CPIs; matching/fills run through an internal
**simulated maker book, labeled `simulated` everywhere it surfaces** (logs, ledger,
dashboard, demo). A future real permissionless orderbook swaps in behind the same
boundary. See GROUND-TRUTH.md and HANDOFF.md.

**Ask to sponsor:** publish the orderbook program IDL + `/api/trading/*` endpoints, and
reconcile the README `settleTrade` reference with the shipped devnet IDL.

---

## F-002 — Live devnet activation works; four real-integration surprises
**Phase:** 1/2 (live wiring) · **Severity:** medium · **Date:** 2026-07-13

Ran the full auth chain live against `txline-dev` with a funded devnet wallet
(`DK2H6r7djsYd4KJQywCgnPjn94552QNJUVFmtJWyzLpJ`): guest JWT → on-chain `subscribe(1, 4)`
(tx confirmed) → `/api/token/activate` → real `X-Api-Token`, then seeded a real corpus for
fixture `18209181` (FRA 2-0 MAR). Four things the docs/IDL did not prepare us for:

1. **`/token/activate` returns the token as PLAIN TEXT** (e.g. `txoracle_api_…`), not JSON.
   `res.json()` throws; parse defensively (text → try JSON → fall back to raw string).
2. **`odds/snapshot/{id}` returns 0 rows without `?asOf=`** — a bare snapshot is the *current*
   book, which is empty once the match/market has closed. Must pass `asOf` inside the live
   window (we sample across the in-play ts range).
3. **The free World Cup tier (level 1) carries NO 1X2 / match-odds market** — only
   `OVERUNDER_PARTICIPANT_GOALS` (totals, many lines) and `ASIANHANDICAP_PARTICIPANT_GOALS`.
   This blocks validating tissue's 1X2 price against a real 1X2 line on the free tier (see
   HANDOFF open question). Totals validate fine.
4. **Snapshot score records lack a live `Minute`** — only status/period — so in-play minute
   resolves to phase-start (0/45) via our fallback. A live SSE stream may carry finer timing;
   TBD when we record live.

Bonus confirmations: the `Odds` payload carries a **`Pct`** field (de-margined probability %,
e.g. `["57.504","42.481"]`) and `Bookmaker: "TXLineStablePriceDemargined"` — both hard-confirm
D-005 (de-margined consensus). Our de-vig reproduces the official `Pct` to <2 bps (pinned in
`devig.test.ts` REAL CAPTURE).

**Ask to sponsor:** document the plain-text activation response, the `asOf` requirement on
odds snapshots, the per-tier market bundle (which tiers include 1X2?), and the `Pct` field.

## F-005 — Surfpool (local Solana validator) closes the F-004 devnet-rate-limit gap for anchoring, but does not extend to `validate_odds`/`validate_stat` testing
**Phase:** post-submission enhancement · **Severity:** low (tooling, not a TxLINE issue) · **Date:** 2026-07-18

Evaluated [Surfpool](https://github.com/txtx/surfpool) (TXTX/Solana Foundation local
validator, `surfpool start`, auto clone-on-read from mainnet/devnet) as a fix for the
public-devnet RPC rate limiting documented in F-004. Confirmed real, verified findings:

- **Real fit: SPL Memo anchoring.** Tissue's Pre-Match Commitment and periodic checkpoint
  anchoring (`exec/preMatchCommit.ts`, `exec/periodicAnchor.ts`) are self-contained — fund a
  keypair, submit a memo, confirm. Ran Tissue's actual `submitMemo()` code path against a
  local Surfpool instance: real airdrop, real transaction, real confirmation, ~1s round trip,
  vs. the rate-limited public devnet RPC. A guarded test suite
  (`src/exec/surfpoolAnchoring.test.ts`, opt-in via `SURFPOOL_RPC_URL`, matching the
  `TISSUE_LIVE_MODEL_BASE_URL`-guarded live-model test pattern in `apps/analyst`) now covers:
  successful confirmation, insufficient-balance failure, unreachable-RPC failure, 12-way
  truly-concurrent same-keypair submissions (all resolved cleanly, no hang, no thrown
  exception, no signature collision), and independent on-chain verification of a confirmed
  signature via a raw `getTransaction` call.
- **Not a fit, and not attempted: `validate_odds`/`validate_stat`.** These CPI into TxLINE's
  real deployed oracle program and require the submitted off-chain Merkle proof (from
  TxLINE's live REST API) to match whatever root is *currently* live in that program's
  on-chain PDA. Surfpool's account cloning is point-in-time (copy-on-read at first touch,
  not continuously re-synced) — a proof fetched after the clone can mismatch the frozen local
  snapshot. Real verification of that path still requires the live devnet/mainnet run
  documented in F-004; no attempt was made to fake it.
- **Investigated but not included: blockhash-expiry simulation.** Tried using Surfpool's
  `surfnet_timeTravel` cheat code to force a stale-blockhash rejection deterministically.
  Empirically, jumping the slot forward did not reliably invalidate an in-flight blockhash —
  the local block height reset in a way that let a transaction still confirm after a large
  forward jump. Rather than assert on flaky cheat-code behavior, this scenario was left out
  of the test suite; it's an honest gap, not a fabricated pass.

**Ask to sponsor:** none — this is TXTX/Solana Foundation tooling, not a TxLINE finding.
Noted here only because it directly extends F-004's real-integration testing story.

## F-006 — Adversarial input testing surfaced two real bugs; both fixed
**Phase:** post-submission hardening · **Severity:** medium (silent NaN propagation), low (empty analyst answer) · **Date:** 2026-07-18

Built a deliberate malformed/adversarial-input test suite (feed normalization, MCP tool
boundary, analyst HTTP boundary) and found two real defects, both fixed with tests proving
the fix:

1. **`normalize.ts::normalizeOdds` — a single non-numeric price silently poisoned the whole
   market's consensus with `NaN`.** The sign check `priceMilli <= 0` on an uncoerced value
   let a non-numeric string (e.g. a corrupted feed field) through, because `NaN <= 0` is
   `false` in JS. `1000 / priceMilli` then produced `NaN`, and `NaN` summed into `overround`
   corrupted every OTHER selection's de-vigged probability in the same market, not just the
   bad one. Fixed by coercing explicitly and checking `Number.isFinite` before the sign
   check. Also hardened: non-finite/non-numeric `ts` on both score and odds messages now
   rejects the message outright (previously a string could sit unbranded inside a
   `Millis`-typed field, silently breaking downstream ordering/gap arithmetic), and
   cumulative score/red-card stats now clamp negative values to zero instead of producing an
   impossible match state.
2. **`agent.ts::runAnalystQuery` — exhausting `maxRounds` while every round made tool calls
   returned an empty string instead of the intended "(analyst reached the tool-loop limit
   without a final answer)" message.** The fallback used `last?.content ?? fallback`, but a
   tool-calling round with no accompanying text pushes `content: ""` (empty string, not
   null/undefined) into message history — `?? ` doesn't catch that, so the nullish check
   never fired. A user hitting the tool-loop limit saw a blank answer with no explanation.
   Fixed by checking for non-empty content explicitly.

Both were found by directly probing real code paths with adversarial inputs (not by reading
the code and guessing) before writing the regression test, per this project's standing rule:
verify empirically, then encode the finding as a test. Also closed: the odds-side proof
tamper-detection function (`assertProofMatchesMessage`) had zero direct test coverage
despite its score-side sibling being fully tested — added 9 tests covering message-ID
replay, cross-fixture replay, tampered prices, wrong market, and malformed batch summaries.

Investigated and intentionally left uncovered: `LiveDesk`'s persisted-corpus duplicate-
message-ID guard (`loadTape`) can only be reached after a genuinely successful live proof
verification, which requires real Solana RPC infrastructure this test harness doesn't
stand up — same category of gap as the Surfpool blockhash-expiry scenario in F-005.
Documented rather than forced.

**Ask to sponsor:** none — both bugs were in Tissue's own code, not TxLINE's.

## F-007 — New real stream-drop drill passes live; SIGKILL-at-anchor-submission remains blocked by the same F-004 limitation
**Phase:** post-submission hardening · **Severity:** informational · **Date:** 2026-07-18

Attempted to extend `restartDrill.mjs` with additional SIGKILL injection points
(mid-anchor-submission, mid-checkpoint). Re-running the existing SIGKILL drill live against
the real devnet fixture (`18209181`) first, to get a fresh baseline with this session's
rebuilt runtime (Ed25519 signing, checkpoint anchoring, the normalize.ts fixes, etc.):
reconfirmed the exact F-004 limitation — replayed historical corpus messages fail real
TxLINE proof verification (`"score message N has no positive TxLINE sequence"` for scores,
empty proof-fetch detail for odds), so zero messages are ever admitted and the drill never
reaches anchor submission. This is TxLINE's real backend not serving proofs for old/replayed
data, not a Tissue bug — already documented, now reconfirmed against the current build.

Given that root cause blocks any live SIGKILL-at-anchor-submission scenario until either a
genuinely live match is available to tail or TxLINE's proof endpoint serves historical data,
pivoted to a fault class that IS independently real and achievable without needing any
message to pass proof verification: **stream-drop/reconnect resilience**
(`scripts/streamDropDrill.mjs`, `pnpm --filter @tissue/daemon drill:streamdrop`). The relay
gained a real `/__control__/drop` endpoint that forcibly destroys open SSE connections
mid-stream (not a process kill — a severed connection, a distinct fault class from
`restartDrill.mjs`'s crash/restart scenario). Ran live against real devnet infrastructure:

```json
{
  "streamsDroppedCount": 2,
  "survivedWithoutProcessCrash": true,
  "reconnectedBothStreams": true,
  "healthyAfterReconnect": true
}
```

Real sequence observed: both streams connected → forced disconnect → daemon logged
`tissue.stream_unavailable` (detail `"terminated"`) for both streams → automatic reconnect
fired → both streams connected again → `/health` still green. The daemon process was never
killed; this exercises `ingest/sseClient.ts`'s reconnect logic under a real severed
connection, independent of the proof-verification blocker above.

**Ask to sponsor:** same standing ask as F-004 — confirm whether `/api/odds/validation` and
`/api/scores/stat-validation` are expected to serve proofs for historical/replayed messages,
or whether they're intentionally scoped to recent/live data only. This is the one remaining
blocker preventing a full live anchor-submission chaos drill.

## F-008 — On-chain true/false proof verification: scoped, blocked on live-match timing, not on code
**Phase:** post-submission hardening · **Severity:** informational · **Date:** 2026-07-18

Attempted to extend real devnet testing to prove both directions of `validate_odds` /
`validate_stat` on-chain — a genuinely true claim returns true, a deliberately false or
tampered claim is rejected by the **program itself**, not just by Tissue's client-side
`assertProofMatchesMessage` pre-check (matching the practice a direct competitor in this
track documents: both directions validated on real mainnet before trusting a proof
mechanism).

Checked real, current conditions before attempting: `GET /api/fixtures/snapshot`
(real devnet, real credentials) shows no fixture currently live — the nearest kickoff is
~62 minutes out at the time of this check. Confirmed, again, that TxLINE's real proof
endpoint (`/api/odds/validation`) does not serve proofs for older replayed messages
(`"Odds record for messageId ... not found"`), consistent with F-004/F-006/F-007.

Rather than fabricate a pass using synthetic data (which this project has consistently
refused to do), this is left honestly incomplete: the code path already exists and is
unit-tested (`exec/exec.test.ts`'s 9 tamper-detection cases), but demonstrating the
**on-chain program's own** rejection of a false claim — as opposed to Tissue's
client-side gate catching it first — requires either a live match in progress or a
constructed call that passes client-side structural checks but fails on-chain Merkle
verification (e.g. a single corrupted proof-node byte). Both are real, achievable next
steps, not blocked by anything structural — just not completed in this session.

**Ask to sponsor:** none — timing and data availability, not a TxLINE issue.

<!-- Append new entries above this line as friction surfaces during live wiring. -->
