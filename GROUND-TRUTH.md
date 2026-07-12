# GROUND-TRUTH.md — execution & feed facts (Phase 2 gate)

The deliverable of Phase 2. **Phases 5/6/7 design against these facts, not assumptions.**
All citations are to the vendored sponsor repo at commit `f37473a` ("Schedule update",
2026-07-12); paths are relative to `resources/tx-on-chain/`. Anything marked
**UNCONFIRMED** is documented-but-untested here and must be re-verified against a live
endpoint or the hosted OpenAPI (`https://txline.txodds.com/docs/docs.yaml`) before relied on.

---

## T1 — Intent-book round trip → **FAILS (gated STOP, then resolved by decision D-001)**

**Finding: the on-chain intent-book the original design assumed does not exist.** The four
instructions `create_intent → execute_match → claim_via_resolution / settle_matched_trade`
appear **0 times** anywhere in the repo (README, docs, all three IDLs, examples, types).

The on-chain `txoracle` program is a **data-oracle + subscription + validation** program.
Full instruction set (devnet `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, mainnet
`9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`; `idl/txoracle.json`):

```
subscribe · purchase_subscription_token_usdt · withdraw_usdt
insert_batch_root · insert_fixtures_root · insert_scores_root
validate_odds · validate_stat · validate_stat_v2 (· validate_stat_v3 devnet)
validate_fixture · validate_fixture_batch
initialize_pricing_matrix · update_pricing_matrix · close_pricing_matrix
initialize_treasury_v2 · initialize_usdt_treasury
```

The trading model that **does** exist (`README.md:107-131,688+`) is **prediction-based
binary options on US-Football / basketball stats** (e.g. "Team A score > 11 by HT"),
brokered **off-chain** (`/trading/stream` `NewOffer`), settled by **score proofs**. Its
data structures live in the IDL only as placeholder types (`MarketIntentParams` — an empty
struct; `NDimensionalStrategy`, `StatPredicate`, `TraderPredicate`), consumed by **no
instruction**. The README states a permissionless orderbook "is in preparation"
(`README.md:35`) and that `/api/trading/*` REST endpoints are "illustrative until trading
endpoints are published" (`README.md:113`). The README's claim that `settleTrade` "is
available in the Devnet IDL" (`README.md:113`) is **stale** — no such instruction is in the
vendored devnet IDL.

### Odds encoding (pinned — the assumption was wrong)
Original assumption: `OrderIntent.odds = decimal × 100 (u16)`. **Actual:** the `Offer.odds`
field is **decimal × 1000** (`odds: 2000` = 2.0; `README.md:744`). On-chain `Odds.prices`
are `vec<i32>`, also decimal ×1000. TISSUE uses **MilliOdds = decimal×1000** throughout
(`packages/shared/src/units.ts`), aligning our internal encoding with the sponsor's.

### Resolution — decision D-001 (see HANDOFF.md)
`exec/` is a **port**. Provenance anchoring uses the **real** `validate_odds`/`validate_stat`
CPIs (permissionless, callable today). Matching/fills run through an internal
**simulated maker book, labeled `simulated` everywhere it surfaces**. A future real
orderbook swaps in behind the same boundary. This preserves fill-independence (PRD §1.4):
CLV grades every quote against the close whether matched or not.

---

## Auth chain (Phase 1 spine) — confirmed from `examples/devnet/common/users.ts`

| Step | Call | Notes |
|------|------|-------|
| 1. Guest JWT | `POST {origin}/auth/guest/start` (no body) → `{ token }` | host root, **not** under `/api` |
| 2. Subscribe | on-chain `subscribe(service_level_id, weeks)` | `weeks` must be a multiple of 4, min 4 |
| 3. Activate | `POST {origin}/api/token/activate`, header `Authorization: Bearer {jwt}`, body `{ txSig, walletSignature, leagues }` | sign `` `${txSig}:${leagues.join(",")}:${jwt}` `` with `nacl.sign.detached`, base64 |
| 4. Stream/data | headers `Authorization: Bearer {jwt}` **+** `X-Api-Token: {apiToken}` | both required |

- Origins: devnet `https://txline-dev.txodds.com`, mainnet `https://txline.txodds.com`.
- Service levels: **level 1** = free World Cup, 60s delay (mainnet) / 0s (devnet); **level 12**
  = free World Cup **realtime, mainnet only**. Devnet exposes only level 1
  (`documentation/subscription-tiers.mdx`, `worldcup.mdx`).
- **Network-consistency rule** (the #1 documented failure cause): JWT host, activation host,
  RPC, program id, and mint must **all** be the same network (`troubleshooting.mdx:8-20`).
- `subscribe` account set (`users.ts:311-324`): `user`, `pricingMatrix` (PDA `["pricing_matrix"]`),
  `tokenMint`, `userTokenAccount` (Token-2022 ATA), `tokenTreasuryVault` (ATA of
  `tokenTreasuryPda`, allowOwnerOffCurve, Token-2022), `tokenTreasuryPda` (PDA
  `["token_treasury_v2"]`), `tokenProgram = TOKEN_2022_PROGRAM_ID`, `associatedTokenProgram`,
  `systemProgram`.

Implemented in `apps/daemon/src/ingest/txlineAuth.ts` (JWT + activate) — the `subscribe`
CPI is the one live step gated on a funded devnet wallet.

---

## T2 — Feed lag & odds-stream granularity

### SSE endpoints (`streaming-data.mdx`, `subscription_scores*.ts`)
- Scores: `GET {origin}/api/scores/stream` · Odds: `GET {origin}/api/odds/stream`.
- **No query params** — filtering is by subscription bundle, not URL. Reconnect on close
  (~3s), renew JWT on 401/403, resume via `Last-Event-ID`. Heartbeats arrive as SSE comment
  lines (`:`), no documented cadence. Compression: `Accept-Encoding: deflate`/`gzip`.

### Granularity — de-margined **CONSENSUS**, not per-book
The odds channel is TxODDS **StablePrice**: "fully de-margined stable odds (effectively,
probabilities)" (`README.md:62`; `documentation/odds/overview.mdx:6,8,23`). The on-chain
`Odds` struct carries `bookmaker: string` + `bookmaker_id: i32` **slots**, but the docs
describe consensus semantics and the repo ships **no sample odds JSON** to show what those
fields contain for the consensus feed. **Conclusion: treat the stream as consensus; do not
assume individual sportsbook lines.** TISSUE de-vigs defensively anyway (idempotent on
already-de-margined input) — `apps/daemon/src/ingest/normalize.ts`.

### `Odds` struct — full field list (`idl/txoracle.json` type `Odds`)
`fixture_id: i64` · `message_id: string` · `ts: i64` · `bookmaker: string` ·
`bookmaker_id: i32` · `super_odds_type: string` · `game_state: option<string>` ·
`in_running: bool` · `market_parameters: option<string>` · `market_period: option<string>` ·
`price_names: vec<string>` · `prices: vec<i32>` (decimal odds ×1000).

### Feed-lag measurement
- **Mainnet realtime (level 12) vs devnet 60s tier**: the delay is a *tier* property (60s on
  the devnet/level-1 tier, realtime on mainnet level 12), documented in
  `subscription-tiers.mdx` / `worldcup.mdx`. TISSUE measures wall-to-feed lag live via the
  `FeedLagSample` type and the Radar's event→reaction timing (published as the feed-lag
  histogram, PRD §9). On the completed-fixture corpus, "lag" is reconstructed from feed `ts`
  deltas between a match event and the first significant odds reaction (Radar `reactionLatencyMs`).
- **Adverse-selection implication (PRD §5):** on the 60s tier the spread floor scales with
  staleness (`policy.toml strategy.stale_spread_bps_per_sec`), and in-play auto-off if only
  the delayed feed is healthy (`policy.toml feed.in_play_requires_realtime`).

---

## T3 — `validate_odds` CPI semantics & cost

### Args & return (`idl/txoracle.json` instruction `validate_odds`)
```
validate_odds(
  ts: i64,
  odds_snapshot: Odds,
  summary: OddsBatchSummary { fixture_id: i64, update_stats: OddsUpdateStats, odds_sub_tree_root: [u8;32] },
  sub_tree_proof: vec<ProofNode { hash: [u8;32], is_right_sibling: bool }>,
  main_tree_proof: vec<ProofNode>,
) -> bool
```
Single account: `daily_odds_merkle_roots`.

### PDA derivation (docs — **UNCONFIRMED naming**)
The Validation-Accounts tables (`documentation/programs/devnet.mdx:43-47`,
`programs/addresses.mdx:71-75`) document the odds-proof root PDA as seed string
**`daily_batch_roots` + `epochDay` as u16 little-endian**. But the IDL account is named
`daily_odds_merkle_roots`, and the IDL emits **no seeds**. `epochDay` must come from the
proof's own timestamp: `epochDay = floor(odds.Ts / 86_400_000)` (never `Date.now()`),
encoded u16 LE. **Verify the seed on-chain before relying on it** (naming mismatch flagged).

### Return semantics (**inferred**, not documented for odds)
`validate_odds` has no example script. By analogy with the documented siblings
`validate_stat` / `validate_fixture` (both `-> bool`, `onchain-validation.mdx:222-247`): a
**bad Merkle proof reverts** (e.g. `InvalidMainTreeProof`), while a valid inclusion **returns
`true`**. `validate_odds` has no predicate arg (it only proves inclusion), so the expected
behavior is "returns `true` on valid inclusion, reverts on a bad proof." Called read-only via
Anchor `.view()` or `.transaction()` + `simulateTransaction`. **CU cost: UNMEASURED** — no
runnable odds example; measure on first live call.

### Fetching proofs (**UNCONFIRMED endpoint**)
No odds-proof REST endpoint is documented. The analogous documented ones are
`GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` and
`GET /api/fixtures/validation?fixtureId=&timestamp=`, each returning
`{ summary, subTreeProof, mainTreeProof, ... }`. The odds endpoint **likely** mirrors these
(probably `GET /api/odds/validation?fixtureId=&timestamp=` returning
`{ odds, summary, subTreeProof, mainTreeProof }`) — **verify against the hosted OpenAPI**.

### What TISSUE anchors
The ledger anchors **sampled** decision inputs by calling `validate_odds` with the odds
snapshot + fetched proofs (`policy.toml exec.anchor_sample_rate`). Anchoring is the *real*,
permissionless pillar of "the backtest can't lie" even while matching is simulated.

---

## Corpus seeding (Phase 1.3)

- Scores snapshot: `GET /api/scores/snapshot/{fixtureId}[?asOf=ms]`; odds snapshot:
  `GET /api/odds/snapshot/{fixtureId}[?asOf=ms]`; scores historical:
  `GET /api/scores/historical/{fixtureId}` (only fixtures started **2 weeks–6 hours ago**).
  **Snapshots need an activated `X-Api-Token`** — guest JWT alone 401s.
- Completed QF fixture ids (sponsor schedule, `documentation/scores/schedule.mdx`):
  `18209181` FRA 2-0 MAR · `18218149` ESP 2-1 BEL · `18213979` NOR 1-2 ENG ·
  `18222446` ARG 3-1 SUI. World Cup `competitionId=72`.
- Until activation is wired, the **deterministic synthetic corpus**
  (`apps/daemon/src/ingest/synthetic.ts`, `corpus/SYN-QF1.jsonl`) is the guaranteed input for
  pricing tests and replay-equality CI.

## Soccer scores encoding (`documentation/scores/soccer-feed.mdx`)
- Stat keys 1-8: P1/P2 goals(1,2), yellows(3,4), **reds(5,6)**, corners(7,8). Period prefixes
  0=Total, 1000=H1, 2000=HT, 3000=H2, 4000=ET1, 5000=ET2, 6000=PE, 7000=ETTotal.
- Status (game phase) enum NS=1…F=5…FET=10; **`game_finalised` uses statusId=100, period=100**.
- **"Attack/Danger/HighDanger" are NOT possession** — they are `free_kick.Data.FreeKickType`
  danger levels (`Safe·Attack·Danger·HighDanger·Offside`). No possession-% stat exists. See
  HANDOFF D-004 for how the pressure modifier consumes these discrete danger events instead.

All encodings are implemented in `apps/daemon/src/ingest/soccerFeed.ts` + `normalize.ts`.
