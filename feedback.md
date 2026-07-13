# TxLINE API feedback — friction log

Logged from minute one (scored submission component, PRD §9). Each entry: what we
tried, what we expected, what happened, and the workaround. Newest first.

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

<!-- Append new entries above this line as friction surfaces during live wiring. -->
