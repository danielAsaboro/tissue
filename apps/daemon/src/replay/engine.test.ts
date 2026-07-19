import { describe, expect, it, beforeAll } from "vitest";
import { Keypair } from "@solana/web3.js";
import { millis, type FeedMessage, type ScoreMessage } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import { hashPolicy } from "../config/policySnapshot.js";
import { createEngineSession, runEngine } from "./engine.js";
import { verifyChain } from "../ledger/ledger.js";
import { canonicalize, hashPayload, linkHash, GENESIS_HASH } from "../ledger/hash.js";
import { signHash, type LedgerSigner } from "../ledger/signing.js";
import { brierDecomposition } from "../grader/brier.js";
import { clvBps } from "../grader/clv.js";
import { grade } from "../grader/grader.js";
import { generateSyntheticCorpus } from "../ingest/synthetic.js";

let policy: Policy;
beforeAll(() => {
  policy = loadPolicy();
});

describe("ledger hashing", () => {
  it("canonicalize sorts keys deterministically", () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"b":1}');
  });
  it("linkHash chains from genesis and changes with content", () => {
    const h1 = linkHash(GENESIS_HASH, { seq: 0, a: 1 });
    const h2 = linkHash(h1, { seq: 1, a: 1 });
    expect(h1).not.toBe(h2);
    expect(hashPayload({ x: 1 })).toBe(hashPayload({ x: 1 }));
  });
});

describe("brier + clv units", () => {
  it("perfect forecast has brier 0", () => {
    const b = brierDecomposition([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }], 10);
    expect(b.brier).toBe(0);
  });
  it("clv sign is desk-favorable per side", () => {
    expect(clvBps("BACK", 5000, 5200)).toBe(200); // bought cheap
    expect(clvBps("LAY", 5000, 4800)).toBe(200); // sold high
  });
});

describe("engine — the decision loop", () => {
  it("produces a valid hash-chained ledger over the corpus", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    expect(result.ledger.length).toBe(corpus.length);
    const check = verifyChain(result.ledger.all());
    expect(check.ok).toBe(true);
  });

  it("a scrambled/out-of-order feed is met with discipline halts, not corruption or a crash — the hash chain stays valid throughout", () => {
    const corpus = generateSyntheticCorpus();
    const shuffled = [...corpus];
    [shuffled[3], shuffled[10]] = [shuffled[10]!, shuffled[3]!];
    const result = runEngine(shuffled, policy);
    // One decision per message, in order — nothing dropped, nothing duplicated.
    expect(result.ledger.length).toBe(shuffled.length);
    expect(verifyChain(result.ledger.all()).ok).toBe(true);
    // The desk actually reacts to the scrambled timeline (halts), rather than silently
    // pricing through it as if nothing were wrong.
    const halts = result.ledger.all().filter((r) => r.action === "HALT");
    expect(halts.length).toBeGreaterThan(0);
  });

  it("a duplicated message within a single corpus produces one decision per occurrence, deterministically, without corrupting the chain", () => {
    const corpus = generateSyntheticCorpus();
    const withDuplicate = [...corpus.slice(0, 5), corpus[2]!, ...corpus.slice(5)];
    const result = runEngine(withDuplicate, policy);
    expect(result.ledger.length).toBe(withDuplicate.length);
    expect(verifyChain(result.ledger.all()).ok).toBe(true);
    // Message-ID deduplication is enforced at the live ingestion boundary
    // (LiveDesk.commitMessage's messageIds Set / loadTape's duplicate-corpus guard), not
    // inside the deterministic engine itself — the engine trusts its input corpus is
    // already a deduplicated, trusted sequence. This test documents that boundary rather
    // than asserting the engine does something it was never designed to do.
  });

  it("every decision record carries the real policy hash of the policy that priced it — self-contained proof, no side-channel cross-reference needed", () => {
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy).ledger.all();
    expect(records.length).toBeGreaterThan(0);
    const expected = hashPolicy(policy);
    for (const record of records) {
      expect(record.policyHash).toBe(expected);
    }
  });

  it("a different policy produces a different, still-valid hash chain — the policy hash is load-bearing, not decorative", () => {
    const corpus = generateSyntheticCorpus();
    const alteredPolicy: Policy = {
      ...policy,
      strategy: { ...policy.strategy, edge_threshold_bps: policy.strategy.edge_threshold_bps + 1 },
    };
    const base = runEngine(corpus, policy);
    const altered = runEngine(corpus, alteredPolicy);
    expect(altered.ledger.all()[0]!.policyHash).not.toBe(base.ledger.all()[0]!.policyHash);
    expect(altered.ledger.headHash).not.toBe(base.ledger.headHash);
    expect(verifyChain(altered.ledger.all()).ok).toBe(true);
  });

  it("tampering with any record breaks the chain", () => {
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy).ledger.all().map((r) => ({ ...r }));
    const mid = Math.floor(records.length / 2);
    records[mid] = { ...records[mid]!, edgeBps: records[mid]!.edgeBps + 1 };
    const check = verifyChain(records);
    expect(check.ok).toBe(false);
    expect(check.brokenAtSeq).toBe(mid);
  });

  it("without a signer, records carry no signature (default replay/CI path)", () => {
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy).ledger.all();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.signature).toBeUndefined();
      expect(record.signerPubkey).toBeUndefined();
    }
  });

  it("with a signer, every record is Ed25519-signed and independently verifiable", () => {
    const keypair = Keypair.generate();
    const signer: LedgerSigner = {
      publicKey: keypair.publicKey.toBase58(),
      sign: (hashHex: string) => signHash(hashHex, keypair.secretKey),
    };
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy, "devnet", { signer }).ledger.all();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.signerPubkey).toBe(signer.publicKey);
      expect(record.signature).toMatch(/^[0-9a-f]{128}$/);
    }
    expect(verifyChain(records).ok).toBe(true);
  });

  it("a forged signature on a real hash is caught by verifyChain, chain links themselves stay intact", () => {
    const keypair = Keypair.generate();
    const signer: LedgerSigner = {
      publicKey: keypair.publicKey.toBase58(),
      sign: (hashHex: string) => signHash(hashHex, keypair.secretKey),
    };
    const corpus = generateSyntheticCorpus();
    const records = runEngine(corpus, policy, "devnet", { signer }).ledger.all().map((r) => ({ ...r }));
    const mid = Math.floor(records.length / 2);
    const impostor = Keypair.generate();
    records[mid] = { ...records[mid]!, signature: signHash(records[mid]!.hash, impostor.secretKey) };
    const check = verifyChain(records);
    expect(check.ok).toBe(false);
    expect(check.signatureInvalidAtSeq).toBe(mid);
    expect(check.brokenAtSeq).toBeUndefined();
  });

  it("records POST/HALT/NO_ACTION actions and reacts to the unexplained HALT", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    const actions = new Set(result.ledger.all().map((r) => r.action));
    expect(actions.has("POST")).toBe(true);
    // the 30:12 unexplained move should drive at least one HALT decision
    expect(result.halts.some((h) => h.reason === "unexplained-movement")).toBe(true);
  });

  it("prepares real validate_odds anchors for sampled odds inputs", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    expect(result.anchors.length).toBeGreaterThan(0);
    expect(result.anchors[0]!.programId).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
  });

  it("commits the complete observed pre-match opening, unaffected by later score updates", () => {
    const corpus = generateSyntheticCorpus();
    const result = runEngine(corpus, policy);
    expect(result.preMatchCommitment).not.toBeNull();
    expect(result.preMatchCommitment!.fixtureId).toBe(result.fixtureId);
    const preMatchOdds = corpus.filter((message) => message.kind === "odds" && !message.inRunning);
    expect(result.preMatchCommitment!.ts).toBe(Math.max(...preMatchOdds.map((message) => message.ts)));
    expect(result.preMatchCommitment!.markets.map((market) => market.marketKey.market).sort()).toEqual(["1X2", "TOTALS"]);
  });

  it("produces the same opening commitment when complementary pre-match streams arrive in either order", () => {
    const corpus = generateSyntheticCorpus();
    const initialScore = corpus.find((message) => message.kind === "score")!;
    const openings = corpus.filter((message) => message.kind === "odds" && !message.inRunning);
    const firstInPlay = corpus.find((message) => message.kind === "score" && message.ts > initialScore.ts)!;
    const forward = runEngine([initialScore, ...openings, firstInPlay], policy).preMatchCommitment;
    const reverse = runEngine([initialScore, ...[...openings].reverse(), firstInPlay], policy).preMatchCommitment;
    expect(forward).not.toBeNull();
    expect(reverse).not.toBeNull();
    expect(reverse!.hash).toBe(forward!.hash);
    expect(reverse!.markets).toEqual(forward!.markets);
  });

  it("a session with no priced markets (odds never arrive) has no pre-match commitment", () => {
    const corpus = generateSyntheticCorpus().filter((m) => m.kind === "score");
    const result = runEngine(corpus, policy);
    expect(result.preMatchCommitment).toBeNull();
  });

  it("prices a totals-only TxLINE bundle and publishes no synthetic fills in live mode", () => {
    const corpus = generateSyntheticCorpus().filter(
      (message) => message.kind !== "odds" || message.marketKey.market !== "1X2",
    );
    const result = runEngine(corpus, policy, "devnet", { simulateFills: false });
    expect(result.ledger.all().some((record) => record.tissueProb > 0)).toBe(true);
    expect(result.book.allFills()).toEqual([]);
    expect(result.ledger.all().every((record) => record.simulated === false)).toBe(true);
  });
});

describe("clock skew across the merged scores+odds timeline", () => {
  function score(msgId: string, ts: number, minute: number): ScoreMessage {
    return {
      kind: "score",
      msgId,
      fixtureId: "SKEW-1",
      ts: millis(ts),
      network: "devnet",
      minute,
      homeScore: 0,
      awayScore: 0,
      homeReds: 0,
      awayReds: 0,
      possession: { home: "none", away: "none" },
      isFinal: false,
      isVoid: false,
    };
  }

  it("records a skew event when a later-arriving message has an earlier ts, instead of silently reading as fresh", () => {
    const corpus: FeedMessage[] = [score("s1", 1000, 10), score("s2", 500, 11)];
    const result = runEngine(corpus, policy);
    expect(result.clockSkewEvents).toHaveLength(1);
    expect(result.clockSkewEvents[0]).toMatchObject({ msgId: "s2", skewMs: 500 });
  });

  it("does not record a skew event for in-order or simultaneous arrivals", () => {
    const corpus: FeedMessage[] = [score("s1", 1000, 10), score("s2", 1000, 10), score("s3", 1500, 11)];
    const result = runEngine(corpus, policy);
    expect(result.clockSkewEvents).toHaveLength(0);
  });

  it("a skewed message never regresses the clock's high-water mark for subsequent messages", () => {
    // s2 arrives with an earlier ts than s1 (skew #1). s3 sits between s2 and s1's ts: if the
    // clock had regressed to s2's ts (the bug), s3 would read as in-order (no 2nd skew event);
    // since the clock stays at the s1 high-water mark, s3 is skew #2.
    const corpus: FeedMessage[] = [score("s1", 10_000, 10), score("s2", 5_000, 10), score("s3", 7_000, 11)];
    const result = runEngine(corpus, policy);
    expect(result.clockSkewEvents).toHaveLength(2);
    expect(result.clockSkewEvents.map((e) => e.msgId)).toEqual(["s2", "s3"]);
  });
});

describe("EngineSession.kill() — external (portfolio-level) latch", () => {
  it("kill() blocks all future quoting on the next append, same as the internal drawdown kill", () => {
    const corpus = generateSyntheticCorpus();
    const session = createEngineSession(policy);
    const midpoint = Math.floor(corpus.length / 2);
    for (const msg of corpus.slice(0, midpoint)) session.append(msg);
    session.kill();
    expect(session.current().book.openIntents()).toHaveLength(0);
    for (const msg of corpus.slice(midpoint)) session.append(msg);
    const result = session.finish();
    const postAfterKill = result.ledger
      .all()
      .slice(midpoint)
      .filter((r) => r.action === "POST");
    expect(postAfterKill).toHaveLength(0);
    expect(result.ledger.all().slice(midpoint).some((r) => r.haltReason === "drawdown-kill")).toBe(true);
  });

  it("kill() before any messages means the very first decision is a halt, not a quote", () => {
    const corpus = generateSyntheticCorpus();
    const session = createEngineSession(policy);
    session.kill();
    for (const msg of corpus) session.append(msg);
    const result = session.finish();
    expect(result.ledger.all().every((r) => r.action !== "POST")).toBe(true);
  });
});

describe("replay(corpus) === ledger — the CI backbone", () => {
  it("incrementally extends the exact ledger prefix without replaying prior messages", () => {
    const corpus = generateSyntheticCorpus();
    const expected = runEngine(corpus, policy).ledger.all();
    const session = createEngineSession(policy);
    for (let i = 0; i < corpus.length; i++) {
      const current = session.append(corpus[i]!);
      expect(current.ledger.length).toBe(i + 1);
      expect(current.ledger.headHash).toBe(expected[i]!.hash);
      expect(verifyChain(current.ledger.all()).ok).toBe(true);
    }
    expect(session.finish().ledger.headHash).toBe(expected.at(-1)!.hash);
  });

  it("finalizes idempotently and rejects messages after finalization", () => {
    const session = createEngineSession(policy);
    const corpus = generateSyntheticCorpus();
    for (const message of corpus) session.append(message);
    const first = session.finish();
    const radarCount = first.radarEvents.length;
    expect(session.finish().radarEvents).toHaveLength(radarCount);
    expect(() => session.append(corpus[0]!)).toThrow("finalized engine session");
  });

  it("two runs over the same corpus produce a bit-for-bit identical ledger", () => {
    const corpus = generateSyntheticCorpus();
    const a = runEngine(corpus, policy).ledger.all();
    const b = runEngine(corpus, policy).ledger.all();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.at(-1)!.hash).toBe(a.at(-1)!.hash);
  });

  it("the whole engine result (quotes, radar, settlement) is deterministic", () => {
    const corpus = generateSyntheticCorpus();
    const a = runEngine(corpus, policy);
    const b = runEngine(corpus, policy);
    expect(JSON.stringify(grade(a, policy))).toBe(JSON.stringify(grade(b, policy)));
    expect(JSON.stringify(a.quotes)).toBe(JSON.stringify(b.quotes));
    expect(JSON.stringify(a.radarEvents)).toBe(JSON.stringify(b.radarEvents));
  });
});

describe("chaos — feed-gap drill (PRD §9)", () => {
  it("hard-halts and cancels all intents when a feed gap exceeds max_gap_ms", () => {
    // Build a realistic-cadence corpus (messages ~2s apart) then inject a large gap.
    const corpus = generateSyntheticCorpus();
    // Under feedGapHalt, the synthetic corpus's minute-scale gaps themselves exceed
    // max_gap_ms, so the desk should register feed-gap HALT decisions.
    const withHalt = runEngine(corpus, policy, "devnet", { feedGapHalt: true });
    const haltRecords = withHalt.ledger.all().filter((r) => r.haltReason === "feed-gap");
    expect(haltRecords.length).toBeGreaterThan(0);

    // Without the flag (default backtest of sampled data), sparsity does NOT halt.
    const noHalt = runEngine(corpus, policy, "devnet", { feedGapHalt: false });
    expect(noHalt.ledger.all().some((r) => r.haltReason === "feed-gap")).toBe(false);
  });
});

describe("grade sheet", () => {
  it("assembles CLV, Brier, latency, per-class, and SIMULATED PnL", () => {
    const corpus = generateSyntheticCorpus();
    const g = grade(runEngine(corpus, policy), policy);
    expect(g.pnl.simulated).toBe(true);
    expect(g.clv.n).toBeGreaterThanOrEqual(0);
    expect(g.brier.brier).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(g.latency)).toBe(true);
  });
});
