# TxLINE API feedback — friction log

Logged from minute one (scored submission component, PRD §9). Each entry: what we
tried, what we expected, what happened, and the workaround. Newest first.

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

<!-- Append new entries above this line as friction surfaces during live wiring. -->
