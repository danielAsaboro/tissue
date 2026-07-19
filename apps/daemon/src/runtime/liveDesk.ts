import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marketKeyString, type AnalystExport, type DecisionRecord, type FeedMessage } from "@tissue/shared";
import { loadTissueSlipConfig, type TissueSlipConfig } from "@tissue/slip";
import { loadPolicy, type Policy } from "../config/policy.js";
import { CORPUS_DIR } from "../ingest/corpus.js";
import { fetchGuestJwt, type AuthCredentials } from "../ingest/txlineAuth.js";
import { SseClient, type StreamKind } from "../ingest/sseClient.js";
import { grade } from "../grader/grader.js";
import { verifyChain } from "../ledger/ledger.js";
import { createEngineSession, type EngineResult, type EngineSession } from "../replay/engine.js";
import type { LiveConfig } from "./config.js";
import type { DeskSnapshot, FixtureSnapshot, StreamState } from "./types.js";
import { verifyOddsOnChain, type AnchorEvidence } from "../exec/anchorLive.js";
import { verifyScoreOnChain } from "../exec/scoreAnchorLive.js";
import { submitPreMatchCommitment, type PreMatchCommitmentEvidence } from "../exec/preMatchCommit.js";
import { isCheckpointDue, prepareCheckpointAnchor, submitCheckpointAnchor, type CheckpointAnchorEvidence } from "../exec/periodicAnchor.js";
import { SlipVenueAdapter } from "../exec/slipVenue.js";
import { executeThroughVenue, failedVenueEvidence, type VenueAdapter, type VenueExecutionEvidence, type VenueTradeCandidate } from "../exec/venue.js";
import { loadLedgerSigner, type LedgerSigner } from "../ledger/signing.js";
import { hashPolicy, type PolicySnapshotEntry } from "../config/policySnapshot.js";
import { DEFAULT_LATENCY_BUCKETS_MS, LatencyHistogram } from "./latencyHistogram.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPostgresLiveStore, type LiveStore } from "../storage/liveStore.js";

type Listener = (snapshot: DeskSnapshot) => void;

export function admittedSourceMessage(message: FeedMessage): FeedMessage {
  if (message.kind === "odds") return message;
  // TxLINE's stat proof authenticates cumulative goals/reds and period, but not the
  // free-kick/shot payload used by the optional pressure heuristic. Keep those
  // unproved event fields out of live pricing; replay research can still evaluate them.
  return { ...message, possession: { home: "none", away: "none" } };
}

export async function assertPersistedLedgerPrefix(fixtureId: string, rebuilt: EngineResult, store: LiveStore): Promise<void> {
  let persisted;
  try {
    persisted = await store.readDecisions(fixtureId);
  } catch (error) {
    throw new Error(`persisted ledger for ${fixtureId} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (persisted.length === 0) return;
  if (!verifyChain(persisted).ok) throw new Error(`persisted ledger hash chain is broken for ${fixtureId}`);
  const rebuiltRecords = rebuilt.ledger.all();
  if (persisted.length > rebuiltRecords.length) {
    throw new Error(`persisted ledger for ${fixtureId} is ahead of its authoritative corpus`);
  }
  for (let i = 0; i < persisted.length; i++) {
    if (persisted[i]!.hash !== rebuiltRecords[i]!.hash) {
      throw new Error(`persisted ledger for ${fixtureId} diverges from its authoritative corpus at seq ${i}`);
    }
  }
}

/** Complete only the missing deterministic suffix after a corpus-first crash. */
export async function reconcilePersistedLedger(fixtureId: string, rebuilt: EngineResult, store: LiveStore): Promise<void> {
  const persistedLength = (await store.readDecisions(fixtureId)).length;
  for (const record of rebuilt.ledger.all().slice(persistedLength)) {
    await store.appendDecision(fixtureId, record);
  }
}

/**
 * Sums exposure/drawdown across every fixture's latest decision — pure, so the portfolio
 * aggregation math is testable without standing up the full SSE live-desk harness.
 */
export function sumPortfolioRisk(
  results: Iterable<EngineResult>,
): { exposureUnits: number; drawdownUnits: number } {
  let exposureUnits = 0;
  let drawdownUnits = 0;
  for (const result of results) {
    const latest = result.ledger.all().at(-1);
    if (!latest) continue;
    exposureUnits += latest.state.exposure.perFixtureUnits;
    drawdownUnits += latest.state.exposure.drawdownUnits;
  }
  return { exposureUnits, drawdownUnits };
}

export class LiveDesk {
  private readonly policy: Policy;
  private credentials: AuthCredentials;
  private readonly startedAt = Date.now();
  private updatedAt = this.startedAt;
  private lastFeedAt: number | null = null;
  private error: string | undefined;
  private readonly streamErrors: Partial<Record<StreamKind, string>> = {};
  private activeFixtureId: string | null = null;
  /** Portfolio-level kill latch ACROSS every fixture — see enforcePortfolioRisk(). */
  private portfolioKilled = false;
  /** A max-gap breach is process-lifetime: reconnect telemetry cannot silently re-enable risk. */
  private feedGapKilled = false;
  /** Aggregate proof-failure-rate circuit breaker — see recordProofOutcome(). Distinct from
   *  per-message admission failure (proofErrors): this catches a systemically degraded proof
   *  service, not one bad message. Operator-restart-only, like every other kill latch here. */
  private proofCircuitKilled = false;
  private proofCircuitReason: string | undefined;
  private readonly recentProofOutcomes: boolean[] = [];
  private readonly tapes = new Map<string, FeedMessage[]>();
  private readonly messageIds = new Map<string, Set<string>>();
  private readonly results = new Map<string, EngineResult>();
  private readonly sessions = new Map<string, EngineSession>();
  private readonly clients: SseClient[] = [];
  private readonly clientLoops: Promise<void>[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly anchorEvidence = new Map<string, AnchorEvidence>();
  private readonly preMatchCommitments = new Map<string, PreMatchCommitmentEvidence>();
  private readonly checkpoints = new Map<string, CheckpointAnchorEvidence[]>();
  private readonly lastCheckpointSeq = new Map<string, number>();
  private readonly pendingCheckpointFixtureIds = new Set<string>();
  private checkpointQueue: Promise<void> = Promise.resolve();
  /** Only adapters with a complete real boundary are registered. Slip is currently the sole
   * adapter; future venue names do not appear here until discovery through reconciliation works. */
  private readonly venueAdapters: readonly VenueAdapter[];
  private readonly venueExecutions = new Map<string, VenueExecutionEvidence[]>();
  private readonly lastVenueSeq = new Map<string, number>();
  private venueQueue: Promise<void> = Promise.resolve();
  private venueLifecycleTimer: ReturnType<typeof setInterval> | undefined;
  private readonly pendingAnchorIds = new Set<string>();
  private readonly proofErrors = new Map<string, string>();
  private readonly securityCounters = {
    streamFailures: 0,
    sourceProofFailures: 0,
    sourceAdmissionFailures: 0,
  };
  /** Real timing, not estimated: time inside the TxLINE proof round-trip, and end-to-end time
   *  from message receipt to a decision landing in the ledger (verify + admit + engine +
   *  durable append) — the two numbers that actually decide whether the desk keeps up. */
  private readonly proofVerificationLatencyMs = new LatencyHistogram(DEFAULT_LATENCY_BUCKETS_MS);
  private readonly decisionLoopLatencyMs = new LatencyHistogram(DEFAULT_LATENCY_BUCKETS_MS);
  /** Ordered per fixture, concurrent across fixtures to avoid global proof head-of-line blocking. */
  private readonly anchorQueues = new Map<string, Promise<void>>();
  private commitQueue: Promise<void> = Promise.resolve();
  private readonly pendingCommitmentIds = new Set<string>();
  private readonly streams: Record<StreamKind, StreamState> = {
    scores: { connected: false, gapMs: 0, lastActivityAt: null },
    odds: { connected: false, gapMs: 0, lastActivityAt: null },
  };

  /** Loaded once at construction from the same keypair used for on-chain anchoring — never
   *  re-read per record. Undefined when no keypair is configured (records stay unsigned). */
  private readonly signer: LedgerSigner | undefined;

  /** Real, periodically-refreshed SOL balance of the anchoring keypair — anchoring/commit
   *  transactions fail for lack of funds with no other visible symptom until attempted;
   *  this surfaces the risk proactively on /health and /metrics instead. */
  private walletLamports: number | null = null;
  private walletBalanceCheckedAt: number | null = null;
  private walletBalanceTimer: ReturnType<typeof setInterval> | undefined;

  private readonly store: LiveStore;

  constructor(
    private readonly config: LiveConfig,
    credentials: AuthCredentials,
    policy: Policy = loadPolicy(),
    store: LiveStore = createPostgresLiveStore(config.databaseUrl),
  ) {
    this.credentials = credentials;
    this.policy = policy;
    this.store = store;
    this.signer = loadLedgerSigner(config.keypairPath);
    const slipConfig: TissueSlipConfig | null = loadTissueSlipConfig();
    this.venueAdapters = slipConfig && policy.exec.slip.enabled
      ? [new SlipVenueAdapter({
        rpcUrl: slipConfig.rpcUrl,
        keypairPath: config.keypairPath,
        slipConfig,
        minVenueEdgeBps: policy.exec.slip.min_venue_edge_bps,
        policy,
        lifecycleOptions: () => ({
          rpcUrl: slipConfig.rpcUrl,
          keypairPath: config.keypairPath,
          slipConfig,
          scoreProof: {
            origin: config.origin,
            rpcUrl: config.rpcUrl,
            network: config.network,
            credentials: this.credentials,
          },
        }),
      })]
      : [];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.recordPolicySnapshot();
    await this.loadAnchorEvidence();
    await this.loadPreMatchCommitments();
    await this.loadCheckpoints();
    await this.loadVenueExecutions();
    if (this.venueAdapters.length > 0) {
      this.reconcileVenueLifecycles();
      this.venueLifecycleTimer = setInterval(
        () => this.reconcileVenueLifecycles(),
        this.policy.exec.slip.reconcile_interval_ms,
      );
    }
    if (this.signer) {
      void this.checkWalletBalance();
      this.walletBalanceTimer = setInterval(
        () => void this.checkWalletBalance(),
        this.policy.exec.wallet_balance_check_interval_ms,
      );
    }
    for (const stream of ["scores", "odds"] as const) {
      const client = new SseClient({
        origin: this.config.origin,
        network: this.config.network,
        stream,
        maxGapMs: this.policy.feed.max_gap_ms,
        softStaleMs: this.policy.feed.soft_stale_ms,
        getCreds: () => this.credentials,
        renewJwt: async () => {
          const jwt = await fetchGuestJwt(this.config.origin);
          this.credentials = { ...this.credentials, jwt };
        },
        onMessage: (message) => this.onMessage(stream, message),
        onGap: (gapMs) => this.onGap(stream, gapMs),
        onError: (error) => this.onStreamError(stream, error),
      });
      this.clients.push(client);
      this.clientLoops.push(client.start().catch((error: unknown) => this.onStreamError(stream, error)));
    }
    this.publish();
  }

  async stop(): Promise<void> {
    if (this.walletBalanceTimer) clearInterval(this.walletBalanceTimer);
    if (this.venueLifecycleTimer) clearInterval(this.venueLifecycleTimer);
    for (const client of this.clients) client.stop();
    await Promise.all(this.clientLoops);
    await this.store.close();
  }

  /** Real getBalance() RPC call against the anchoring keypair. Failures are logged and
   *  leave the previous cached balance in place rather than reporting a false zero. */
  private async checkWalletBalance(): Promise<void> {
    if (!this.signer) return;
    try {
      const connection = new Connection(this.config.rpcUrl, "confirmed");
      const lamports = await connection.getBalance(new PublicKey(this.signer.publicKey), "confirmed");
      this.walletLamports = lamports;
      this.walletBalanceCheckedAt = Date.now();
      if (lamports < this.policy.exec.wallet_low_balance_lamports) {
        console.error(JSON.stringify({
          event: "tissue.wallet_balance_low",
          lamports,
          threshold: this.policy.exec.wallet_low_balance_lamports,
          pubkey: this.signer.publicKey,
        }));
      }
      this.publish();
    } catch (error) {
      console.error(JSON.stringify({
        event: "tissue.wallet_balance_check_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Full (unsliced) record hashes for a fixture's ledger — snapshot()/fixtureSnapshot() cap
   *  the decisions array at the last 200 for transport size, but a Merkle inclusion proof for
   *  an older decision needs every leaf back to genesis. */
  getLedgerRecordHashes(fixtureId: string): readonly string[] | undefined {
    return this.results.get(fixtureId)?.ledger.all().map((r) => r.hash);
  }

  getCheckpoints(fixtureId: string): readonly CheckpointAnchorEvidence[] {
    return this.checkpoints.get(fixtureId) ?? [];
  }

  /** Durable live corpus for a fixture — used by /arena, /arena/ablation, /grade-card.svg to
   *  re-run the deterministic engine on demand against the SAME authoritative record this
   *  desk captured (not the in-memory tape, which caps replay only to what's still resident). */
  readLiveTape(fixtureId: string): Promise<FeedMessage[]> {
    return this.store.readLiveTape(fixtureId);
  }

  /** Every fixture this store has any corpus for — live-desk-processed or backtest-archive
   *  backfilled — so /backtest can serve a real fixture even when nothing is live right now. */
  listFixtureIds(): Promise<string[]> {
    return this.store.listFixtureIds();
  }

  readPolicySnapshots(): Promise<readonly PolicySnapshotEntry[]> {
    return this.store.readAllPolicySnapshotRows();
  }

  snapshot(): DeskSnapshot {
    const fixtures = [...this.results.entries()]
      .map(([fixtureId, result]) => this.fixtureSnapshot(fixtureId, result))
      .sort((a, b) => b.decisions.at(-1)!.ts - a.decisions.at(-1)!.ts);
    const anyGap = Object.values(this.streams).some((stream) => stream.gapMs >= this.policy.feed.max_gap_ms);
    const lastDecision = this.activeFixtureId
      ? this.results.get(this.activeFixtureId)?.ledger.all().at(-1)
      : undefined;
    const status = this.error
      ? "error"
      : this.portfolioKilled || this.feedGapKilled || anyGap
        ? "halted"
        : this.pendingAnchorIds.size > 0
          ? "verifying"
        : !this.lastFeedAt
          ? "starting"
          : lastDecision?.action === "POST"
            ? "quoting"
            : lastDecision?.action === "HALT"
              ? "halted"
              : "watching";
    return {
      mode: "live",
      execution: "quote-publication",
      status,
      network: this.config.network,
      origin: this.config.origin,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      lastFeedAt: this.lastFeedAt,
      streams: { ...this.streams },
      proofs: {
        pending: this.pendingAnchorIds.size,
        failed: this.proofErrors.size,
        verified: [...this.anchorEvidence.values()].filter((evidence) => evidence.result).length,
        circuitKilled: this.proofCircuitKilled,
      },
      activeFixtureId: this.activeFixtureId,
      fixtures,
      portfolio: this.portfolioSnapshot(),
      wallet: {
        pubkey: this.signer?.publicKey ?? null,
        lamports: this.walletLamports,
        low: this.walletLamports !== null && this.walletLamports < this.policy.exec.wallet_low_balance_lamports,
        checkedAt: this.walletBalanceCheckedAt,
      },
      ...(this.error ? { error: this.error } : {}),
    };
  }

  metrics(): Readonly<typeof this.securityCounters> {
    return { ...this.securityCounters };
  }

  latencyMetricsPrometheus(): string {
    return [
      this.proofVerificationLatencyMs.renderPrometheus(
        "tissue_proof_verification_latency_ms",
        "Time spent inside the TxLINE source-proof round-trip per message.",
      ),
      this.decisionLoopLatencyMs.renderPrometheus(
        "tissue_decision_loop_latency_ms",
        "End-to-end time from message receipt to a decision landing in the ledger (verify + admit + engine + durable append).",
      ),
    ].join("\n");
  }

  private onMessage(stream: StreamKind, message: FeedMessage): void {
    const now = Date.now();
    this.streams[stream] = { connected: true, gapMs: 0, lastActivityAt: now };
    this.lastFeedAt = now;
    this.updatedAt = now;
    this.queueVerification(stream, message);
    this.publish();
  }

  private async commitMessage(stream: StreamKind, message: FeedMessage): Promise<void> {
    const now = Date.now();
    const tape = await this.loadTape(message.fixtureId);
    const messageIds = this.messageIds.get(message.fixtureId);
    if (!messageIds) throw new Error(`message index for ${message.fixtureId} was not initialized`);
    if (messageIds.has(message.msgId)) {
      delete this.streamErrors[stream];
      this.refreshError();
      this.lastFeedAt = now;
      this.updatedAt = now;
      this.publish();
      return;
    }
    const session = this.sessions.get(message.fixtureId);
    if (!session) throw new Error(`engine session for ${message.fixtureId} was not initialized`);
    const previous = this.results.get(message.fixtureId);
    const previousLength = previous?.ledger.length ?? 0;
    const previousHeadHash = previous?.ledger.headHash;
    let result: EngineResult;
    try {
      result = session.append(message);
      this.assertAppendOnly(message.fixtureId, previousLength, previousHeadHash, result);
      // Corpus is authoritative. If the process dies after this append, startup rebuilds the
      // exact missing ledger suffix before accepting another message.
      await this.store.appendLiveMessage(message.fixtureId, message);
      tape.push(message);
      messageIds.add(message.msgId);
      const record = result.ledger.all().at(-1);
      if (!record) throw new Error(`engine produced no decision for ${message.fixtureId}`);
      await this.store.appendDecision(message.fixtureId, record);
      this.results.set(message.fixtureId, result);
      this.activeFixtureId = message.fixtureId;
      this.writeAnalystExport(message.fixtureId, result);
      this.enforcePortfolioRisk();
      this.maybeSubmitPreMatchCommitment(message.fixtureId, result);
      this.maybeSubmitCheckpointAnchor(message.fixtureId, result);
      this.maybeExecuteVenues(message.fixtureId, record);
    } catch (error) {
      // The session mutates before durable writes. Discard every derived in-memory view so a
      // subsequent attempt must rebuild from the authoritative persisted corpus and ledger.
      this.sessions.delete(message.fixtureId);
      this.results.delete(message.fixtureId);
      this.tapes.delete(message.fixtureId);
      this.messageIds.delete(message.fixtureId);
      throw error;
    }
    delete this.streamErrors[stream];
    this.refreshError();
    this.lastFeedAt = now;
    this.updatedAt = now;
    this.publish();
  }

  private async loadTape(fixtureId: string): Promise<FeedMessage[]> {
    const loaded = this.tapes.get(fixtureId);
    if (loaded) return loaded;
    const tape = (await this.store.liveTapeExists(fixtureId)) ? await this.store.readLiveTape(fixtureId) : [];
    const session = createEngineSession(this.policy, this.config.network, {
      feedGapHalt: true,
      simulateFills: false,
      ...(this.signer ? { signer: this.signer } : {}),
    });
    const messageIds = new Set<string>();
    if (tape.length > 0) {
      for (const existing of tape) {
        if (messageIds.has(existing.msgId)) {
          throw new Error(`persisted corpus ${fixtureId} contains duplicate message ${existing.msgId}`);
        }
        messageIds.add(existing.msgId);
        const evidence = await this.verifySource(existing, true);
        this.anchorEvidence.set(existing.msgId, evidence);
        await this.persistAnchorEvidence(evidence);
        if (!evidence.result) {
          throw new Error(
            `persisted corpus ${fixtureId} source proof ${existing.msgId} failed fresh verification: ${evidence.error ?? evidence.status}`,
          );
        }
      }
      for (const message of tape) session.append(message);
      const rebuilt = session.current();
      await assertPersistedLedgerPrefix(fixtureId, rebuilt, this.store);
      await reconcilePersistedLedger(fixtureId, rebuilt, this.store);
      this.results.set(fixtureId, rebuilt);
      this.activeFixtureId ??= fixtureId;
    }
    // A newly discovered fixture must not sneak past an already-tripped portfolio kill.
    if (this.portfolioKilled || this.feedGapKilled || this.proofCircuitKilled) session.kill();
    this.sessions.set(fixtureId, session);
    this.tapes.set(fixtureId, tape);
    this.messageIds.set(fixtureId, messageIds);
    return tape;
  }

  /**
   * Latches every session killed if the portfolio-level policy caps are breached — a loss
   * on one fixture then halts every concurrently running fixture, not just itself.
   * Operator-restart-only: never auto-resets once tripped (same discipline as the
   * per-fixture drawdown kill).
   */
  private enforcePortfolioRisk(): void {
    if (this.portfolioKilled) return;
    const { exposureUnits, drawdownUnits } = sumPortfolioRisk(this.results.values());
    if (
      exposureUnits > this.policy.risk.portfolio_exposure_cap_units
      || drawdownUnits >= this.policy.risk.portfolio_drawdown_kill_units
    ) {
      this.portfolioKilled = true;
      for (const session of this.sessions.values()) session.kill();
      console.error(JSON.stringify({
        event: "tissue.portfolio_kill",
        exposureUnits,
        drawdownUnits,
        exposureCapUnits: this.policy.risk.portfolio_exposure_cap_units,
        drawdownKillUnits: this.policy.risk.portfolio_drawdown_kill_units,
      }));
    }
  }

  private portfolioSnapshot(): DeskSnapshot["portfolio"] {
    return { ...sumPortfolioRisk(this.results.values()), killed: this.portfolioKilled };
  }

  private assertAppendOnly(
    fixtureId: string,
    previousLength: number,
    previousHeadHash: string | undefined,
    next: EngineResult,
  ): void {
    const after = next.ledger.all();
    if (after.length !== previousLength + 1) {
      throw new Error(`decision ledger for ${fixtureId} did not append exactly one record`);
    }
    const appended = after.at(-1);
    if (previousHeadHash !== undefined && (!appended || appended.prevHash !== previousHeadHash)) {
      throw new Error(`decision history for ${fixtureId} did not extend its prior head hash`);
    }
  }

  private onGap(stream: StreamKind, gapMs: number): void {
    this.updatedAt = Date.now();
    this.streams[stream] = {
      connected: false,
      gapMs,
      lastActivityAt: this.streams[stream].lastActivityAt,
    };
    if (gapMs >= this.policy.feed.max_gap_ms && !this.feedGapKilled) {
      this.feedGapKilled = true;
      for (const session of this.sessions.values()) session.kill();
      console.error(JSON.stringify({ event: "tissue.feed_gap_kill", stream, gapMs, thresholdMs: this.policy.feed.max_gap_ms }));
    }
    this.publish();
  }

  private onStreamError(stream: StreamKind, error: unknown): void {
    this.securityCounters.streamFailures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "tissue.stream_unavailable", stream, detail }));
    this.streamErrors[stream] = `${stream} stream unavailable`;
    this.streams[stream] = {
      connected: false,
      gapMs: this.streams[stream].gapMs,
      lastActivityAt: this.streams[stream].lastActivityAt,
    };
    this.refreshError();
    this.updatedAt = Date.now();
    this.publish();
  }

  /**
   * Public error summary (RUNBOOK.md: "Public state exposes only a generic proof failure;
   * exact endpoint/RPC/account diagnostics stay in operator logs"). proofErrors accumulates one
   * entry per currently-failing message, which is unbounded under sustained failure — collapsed
   * to a count here rather than spread verbatim; the per-message detail already went to
   * console.error (tissue.source_proof_failed) for operators.
   */
  private refreshError(): void {
    const errors = [
      ...Object.values(this.streamErrors),
      ...(this.proofErrors.size > 0
        ? [`${this.proofErrors.size} source proof(s) failed — see operator logs for message IDs`]
        : []),
      ...(this.proofCircuitReason ? [this.proofCircuitReason] : []),
    ];
    this.error = errors.length > 0 ? errors.join("; ") : undefined;
  }

  /**
   * Aggregate breaker over a rolling window of source-proof outcomes. A single failed proof
   * already blocks just that message (queueVerification, below) — this fires when the RATE of
   * recent failures crosses policy.risk.proof_failure_rate_halt, meaning the proof service
   * itself is likely degraded, not that one message happened to be bad. Once tripped, stays
   * tripped for this process (operator-restart-only, same as portfolioKilled).
   */
  private recordProofOutcome(success: boolean): void {
    this.recentProofOutcomes.push(success);
    if (this.recentProofOutcomes.length > this.policy.risk.proof_failure_window) this.recentProofOutcomes.shift();
    if (this.proofCircuitKilled) return;
    if (this.recentProofOutcomes.length < this.policy.risk.proof_failure_min_samples) return;
    const failures = this.recentProofOutcomes.filter((ok) => !ok).length;
    const rate = failures / this.recentProofOutcomes.length;
    if (rate < this.policy.risk.proof_failure_rate_halt) return;
    this.proofCircuitKilled = true;
    this.proofCircuitReason = `proof-failure-rate: ${failures}/${this.recentProofOutcomes.length} recent source proofs failed (>= ${Math.round(this.policy.risk.proof_failure_rate_halt * 100)}% threshold) — halted, operator restart required`;
    console.error(JSON.stringify({
      event: "tissue.proof_circuit_halt",
      failures,
      samples: this.recentProofOutcomes.length,
      rate,
    }));
    for (const session of this.sessions.values()) session.kill();
    this.refreshError();
  }

  private queueVerification(stream: StreamKind, message: FeedMessage): void {
    if (this.pendingAnchorIds.has(message.msgId)) return;
    if (this.pendingAnchorIds.size >= 1_024) {
      this.proofCircuitKilled = true;
      this.proofCircuitReason = "source-proof queue exceeded 1024 pending messages — halted, operator restart required";
      for (const session of this.sessions.values()) session.kill();
      this.refreshError();
      this.publish();
      return;
    }
    this.pendingAnchorIds.add(message.msgId);
    const receivedAt = Date.now();
    const prior = this.anchorQueues.get(message.fixtureId) ?? Promise.resolve();
    const queued = prior.catch(() => undefined).then(async () => {
      const verifyStart = Date.now();
      const evidence = await this.verifySource(message, false);
      this.proofVerificationLatencyMs.observe(Date.now() - verifyStart);
      this.anchorEvidence.set(message.msgId, evidence);
      this.pendingAnchorIds.delete(message.msgId);
      await this.persistAnchorEvidence(evidence);
      if (evidence.result) {
        this.proofErrors.delete(message.msgId);
        this.recordProofOutcome(true);
        if (this.proofCircuitKilled || this.feedGapKilled) return;
        await this.commitMessage(stream, admittedSourceMessage(message));
        this.decisionLoopLatencyMs.observe(Date.now() - receivedAt);
        return;
      }
      console.error(JSON.stringify({
        event: "tissue.source_proof_failed",
        messageId: message.msgId,
        status: evidence.status,
        detail: evidence.error,
      }));
      this.securityCounters.sourceProofFailures += 1;
      this.proofErrors.set(message.msgId, `source proof ${message.msgId} failed`);
      this.recordProofOutcome(false);
      this.refreshError();
      this.updatedAt = Date.now();
      this.publish();
    }).catch((error: unknown) => {
      this.securityCounters.sourceAdmissionFailures += 1;
      this.pendingAnchorIds.delete(message.msgId);
      console.error(JSON.stringify({
        event: "tissue.source_admission_failed",
        messageId: message.msgId,
        detail: error instanceof Error ? error.message : String(error),
      }));
      this.proofErrors.set(message.msgId, `source proof ${message.msgId} could not be admitted`);
      this.refreshError();
      this.updatedAt = Date.now();
      this.publish();
    });
    this.anchorQueues.set(message.fixtureId, queued);
    void queued.then(
      () => { if (this.anchorQueues.get(message.fixtureId) === queued) this.anchorQueues.delete(message.fixtureId); },
      () => { if (this.anchorQueues.get(message.fixtureId) === queued) this.anchorQueues.delete(message.fixtureId); },
    );
  }

  private verifySource(message: FeedMessage, recovery: boolean): Promise<AnchorEvidence> {
    if (message.kind === "score") {
      return verifyScoreOnChain(message, {
        origin: this.config.origin,
        rpcUrl: this.config.rpcUrl,
        network: this.config.network,
        credentials: this.credentials,
      });
    }
    return verifyOddsOnChain(message, {
      origin: this.config.origin,
      rpcUrl: this.config.rpcUrl,
      network: this.config.network,
      credentials: this.credentials,
      // Recovery proves the old record again without creating another transaction.
      mode: recovery ? "view" : this.config.anchorMode,
      ...(!recovery && this.config.keypairPath ? { keypairPath: this.config.keypairPath } : {}),
    });
  }

  /** Appends a new signed policy snapshot only when the policy's canonical hash differs from
   *  the last recorded one — see config/policySnapshot.ts for why this is hashed and signed. */
  private async recordPolicySnapshot(): Promise<void> {
    const policyHash = hashPolicy(this.policy);
    const last = await this.store.readLastPolicySnapshotRow();
    if (last && last.policyHash === policyHash) return;
    const entry: PolicySnapshotEntry = {
      recordedAt: Date.now(),
      policyHash,
      ...(this.signer ? { signature: this.signer.sign(policyHash), signerPubkey: this.signer.publicKey } : {}),
    };
    await this.store.appendPolicySnapshotRow(entry);
  }

  private async loadAnchorEvidence(): Promise<void> {
    const rows = await this.store.readAllAnchorEvidenceRows();
    for (const value of rows) {
      const evidence = value as Partial<AnchorEvidence>;
      if (
        typeof evidence.messageId !== "string"
        || typeof evidence.fixtureId !== "string"
        || !Number.isSafeInteger(evidence.ts)
        || evidence.network !== this.config.network
        || (evidence.method !== "view" && evidence.method !== "transaction")
        || typeof evidence.programId !== "string"
        || typeof evidence.rootPda !== "string"
        || typeof evidence.result !== "boolean"
        || !Number.isSafeInteger(evidence.verifiedAt)
        || !["verified", "confirmed", "rejected", "failed"].includes(String(evidence.status))
        || (evidence.txSig !== undefined && typeof evidence.txSig !== "string")
        || (evidence.slot !== undefined && !Number.isSafeInteger(evidence.slot))
        || (evidence.error !== undefined && typeof evidence.error !== "string")
      ) {
        throw new Error("anchor evidence contains an invalid or cross-network record");
      }
      const typed = evidence as AnchorEvidence;
      this.anchorEvidence.set(typed.messageId, typed);
      if (!typed.result) this.proofErrors.set(typed.messageId, `source proof ${typed.messageId} failed`);
    }
    this.refreshError();
  }

  private async persistAnchorEvidence(evidence: AnchorEvidence): Promise<void> {
    await this.store.appendAnchorEvidenceRow(evidence);
  }

  private async loadPreMatchCommitments(): Promise<void> {
    const rows = await this.store.readAllPreMatchCommitmentRows();
    for (const evidence of rows) {
      if (evidence.network === this.config.network) this.preMatchCommitments.set(evidence.fixtureId, evidence);
    }
  }

  private async persistPreMatchCommitment(evidence: PreMatchCommitmentEvidence): Promise<void> {
    await this.store.appendPreMatchCommitmentRow(evidence);
  }

  /**
   * Submit the "Proof of Edge" commitment exactly once per fixture, as soon as the engine
   * has produced one (deterministic replay/engine.ts::preparePreMatchCommitment). Serialized
   * through its own queue so concurrent messages for different fixtures don't race the same
   * keypair's nonce/blockhash.
   */
  private maybeSubmitPreMatchCommitment(fixtureId: string, result: EngineResult): void {
    if (!result.preMatchCommitment) return;
    if (this.preMatchCommitments.has(fixtureId) || this.pendingCommitmentIds.has(fixtureId)) return;
    const commitment = result.preMatchCommitment;
    this.pendingCommitmentIds.add(fixtureId);
    this.commitQueue = this.commitQueue.catch(() => undefined).then(async () => {
      const evidence = await submitPreMatchCommitment(commitment, {
        rpcUrl: this.config.rpcUrl,
        network: this.config.network,
        keypairPath: this.config.keypairPath,
      });
      this.pendingCommitmentIds.delete(fixtureId);
      this.preMatchCommitments.set(fixtureId, evidence);
      await this.persistPreMatchCommitment(evidence);
      if (evidence.status === "failed") {
        console.error(JSON.stringify({ event: "tissue.pre_match_commitment_failed", fixtureId, error: evidence.error }));
      }
      this.updatedAt = Date.now();
      this.publish();
    });
  }

  private async loadCheckpoints(): Promise<void> {
    const rows = await this.store.readAllCheckpointRows();
    for (const evidence of rows) {
      if (evidence.network !== this.config.network) continue;
      const existing = this.checkpoints.get(evidence.fixtureId) ?? [];
      existing.push(evidence);
      this.checkpoints.set(evidence.fixtureId, existing);
      const last = this.lastCheckpointSeq.get(evidence.fixtureId) ?? -1;
      if (evidence.seq > last) this.lastCheckpointSeq.set(evidence.fixtureId, evidence.seq);
    }
  }

  private async persistCheckpoint(evidence: CheckpointAnchorEvidence): Promise<void> {
    await this.store.appendCheckpointRow(evidence);
  }

  /**
   * Fires at most one checkpoint submission in flight per fixture at a time, serialized
   * through its own queue (same reasoning as maybeSubmitPreMatchCommitment: one keypair, one
   * blockhash/nonce lane — concurrent fixtures must not race it).
   */
  private maybeSubmitCheckpointAnchor(fixtureId: string, result: EngineResult): void {
    const interval = this.policy.exec.checkpoint_interval_decisions;
    const seq = result.ledger.length - 1;
    if (seq < 0) return;
    const lastSeq = this.lastCheckpointSeq.get(fixtureId) ?? null;
    if (!isCheckpointDue(seq, lastSeq, interval)) return;
    if (this.pendingCheckpointFixtureIds.has(fixtureId)) return;
    this.pendingCheckpointFixtureIds.add(fixtureId);
    this.lastCheckpointSeq.set(fixtureId, seq);
    const recordHashes = result.ledger.all().slice(0, seq + 1).map((r) => r.hash);
    const commitment = prepareCheckpointAnchor(fixtureId, seq, recordHashes);
    this.checkpointQueue = this.checkpointQueue.catch(() => undefined).then(async () => {
      const evidence = await submitCheckpointAnchor(commitment, {
        rpcUrl: this.config.rpcUrl,
        network: this.config.network,
        keypairPath: this.config.keypairPath,
      });
      this.pendingCheckpointFixtureIds.delete(fixtureId);
      const existing = this.checkpoints.get(fixtureId) ?? [];
      existing.push(evidence);
      this.checkpoints.set(fixtureId, existing);
      await this.persistCheckpoint(evidence);
      if (evidence.status === "failed") {
        console.error(JSON.stringify({ event: "tissue.checkpoint_anchor_failed", fixtureId, seq, error: evidence.error }));
      }
      this.updatedAt = Date.now();
      this.publish();
    });
  }

  private async loadVenueExecutions(): Promise<void> {
    const rows = await this.store.readAllVenueExecutionRows();
    for (const evidence of rows) {
      this.upsertVenueExecution(evidence);
    }
  }

  private async persistVenueExecution(evidence: VenueExecutionEvidence): Promise<void> {
    await this.store.appendVenueExecutionRow(evidence);
  }

  private upsertVenueExecution(evidence: VenueExecutionEvidence): void {
    const existing = this.venueExecutions.get(evidence.fixtureId) ?? [];
    const index = existing.findIndex((row) =>
      row.venue === evidence.venue
      && row.decisionSeq === evidence.decisionSeq
      && row.selection === evidence.selection
      && row.marketKey.market === evidence.marketKey.market
      && row.marketKey.lineTimes10 === evidence.marketKey.lineTimes10,
    );
    if (index >= 0) existing[index] = evidence;
    else existing.push(evidence);
    this.venueExecutions.set(evidence.fixtureId, existing);
  }

  /** Resume each real adapter lifecycle from canonical venue state. The journal is append-only;
   * loadVenueExecutions() folds updates by stable venue + decision identity on restart. */
  private reconcileVenueLifecycles(): void {
    if (this.venueAdapters.length === 0) return;
    this.venueQueue = this.venueQueue.catch(() => undefined).then(async () => {
      for (const [fixtureId, executions] of this.venueExecutions) {
        let terminal: Extract<FeedMessage, { kind: "score" }> | undefined;
        try {
          terminal = (await this.store.readLiveTape(fixtureId))
            .filter((message): message is Extract<FeedMessage, { kind: "score" }> => message.kind === "score")
            .filter((message) => message.isFinal || message.isVoid)
            .at(-1);
        } catch {
          // A confirmed ticket can still be claimed/refunded from canonical Slip state even if
          // its persisted TxLINE corpus is temporarily unavailable; resolution itself will wait.
        }
        for (const evidence of [...executions]) {
          if (evidence.status !== "confirmed") continue;
          if (evidence.lifecycleStatus === "claimed" || evidence.lifecycleStatus === "refunded") continue;
          const adapter = this.venueAdapters.find((candidate) => candidate.id === evidence.venue);
          if (!adapter) continue;
          const updated = await adapter.reconcile(evidence, terminal);
          if (JSON.stringify(updated) !== JSON.stringify(evidence)) {
            this.upsertVenueExecution(updated);
            await this.persistVenueExecution(updated);
            if (updated.lifecycleStatus === "attention-required") {
              console.error(JSON.stringify({
                event: "tissue.venue_lifecycle_attention_required",
                venue: evidence.venue,
                fixtureId,
                decisionSeq: evidence.decisionSeq,
                detail: updated.lifecycleError,
              }));
            }
          }
        }
      }
      this.updatedAt = Date.now();
      this.publish();
    });
  }

  /**
   * Second, stricter authorization on top of the existing quote-publication risk gate
   * (risk/gates.ts::evaluateRisk, already applied inside the engine before this record ever
   * existed). Each registered adapter applies its own capital policy, discovery, liquidity,
   * fee, and fair-value checks before it may sign. The shared lane prevents one fee payer
   * from racing nonces/blockhash work across concurrent fixtures.
   */
  private maybeExecuteVenues(fixtureId: string, record: DecisionRecord): void {
    if (this.venueAdapters.length === 0) return;
    if (record.action !== "POST" || record.intents.length === 0) return;
    const candidates: VenueTradeCandidate[] = record.intents.map((intent) => ({
      marketKey: intent.marketKey,
      selection: intent.selection,
      side: intent.side,
      sizeUnits: intent.sizeUnits,
      edgeBps: intent.edgeBps,
      tissueProbBps: intent.tissueProbBps,
    }));
    for (const adapter of this.venueAdapters) {
      const sequenceKey = `${adapter.id}:${fixtureId}`;
      if ((this.lastVenueSeq.get(sequenceKey) ?? -1) >= record.seq) continue;
      this.lastVenueSeq.set(sequenceKey, record.seq);
      const openForVenue = (this.venueExecutions.get(fixtureId) ?? []).filter((evidence) => evidence.venue === adapter.id);
      const confirmed = openForVenue.filter((evidence) =>
        evidence.status === "confirmed" && evidence.lifecycleStatus !== "claimed" && evidence.lifecycleStatus !== "refunded",
      );
      const exposure = {
        stakedByMarketUnits: confirmed.reduce<Record<string, number>>((byMarket, evidence) => {
          const key = marketKeyString(evidence.marketKey);
          byMarket[key] = (byMarket[key] ?? 0) + evidence.sizeUnits;
          return byMarket;
        }, {}),
        totalStakedUnits: confirmed.reduce((sum, evidence) => sum + evidence.sizeUnits, 0),
      };
      const decision = adapter.authorize(candidates, exposure);
      for (const { candidate, reason } of decision.rejected) {
        const evidence: VenueExecutionEvidence = {
          venue: adapter.id,
          fixtureId,
          decisionSeq: record.seq,
          marketKey: candidate.marketKey,
          selection: candidate.selection,
          side: candidate.side,
          edgeBps: candidate.edgeBps,
          tissueProbBps: candidate.tissueProbBps,
          sizeUnits: candidate.sizeUnits,
          outcomeIndex: -1,
          stakeAmount: "0",
          status: "rejected-by-gate",
          submittedAt: Date.now(),
          error: reason,
        };
        this.upsertVenueExecution(evidence);
        // Rejected-by-gate evidence is informational (no capital moved) — persisted through the
        // same serialized queue as everything else venue-related rather than blocking this
        // synchronous authorization pass on a database round-trip.
        this.venueQueue = this.venueQueue.catch(() => undefined).then(() => this.persistVenueExecution(evidence));
      }
      if (decision.approved.length === 0) continue;
      this.venueQueue = this.venueQueue.catch(() => undefined).then(async () => {
        for (const [index, candidate] of decision.approved.entries()) {
          const request = {
            fixtureId,
            decisionSeq: record.seq,
            nonce: BigInt(record.seq) * 1000n + BigInt(index),
            candidate,
          };
          let evidence: VenueExecutionEvidence;
          try {
            evidence = await executeThroughVenue(adapter, request);
          } catch (error) {
            evidence = failedVenueEvidence(adapter.id, request, error instanceof Error ? error.message : String(error));
          }
          this.upsertVenueExecution(evidence);
          await this.persistVenueExecution(evidence);
          if (evidence.status === "failed") {
            console.error(JSON.stringify({ event: "tissue.venue_execution_failed", venue: adapter.id, fixtureId, seq: record.seq, error: evidence.error }));
          }
        }
        this.updatedAt = Date.now();
        this.publish();
      });
    }
  }

  private fixtureSnapshot(fixtureId: string, result: EngineResult): FixtureSnapshot {
    const records = result.ledger.all();
    return {
      fixtureId,
      messages: this.tapes.get(fixtureId)?.length ?? 0,
      decisions: records.slice(-200),
      quotes: result.quotes.slice(-200),
      radarEvents: result.radarEvents.slice(-200),
      anchors: [...this.anchorEvidence.values()]
        .filter((evidence) => evidence.fixtureId === fixtureId)
        .sort((a, b) => a.ts - b.ts)
        .slice(-200)
        .map((evidence) => ({
          ...evidence,
          ...(evidence.error ? { error: "source validation failed" } : {}),
        })),
      grade: grade(result, this.policy),
      headHash: result.ledger.headHash,
      hashChainOk: verifyChain(records).ok,
      finalScore: result.finalScore,
      preMatchCommitment: this.preMatchCommitments.get(fixtureId) ?? null,
      checkpoints: this.checkpoints.get(fixtureId) ?? [],
      venueExecutions: (this.venueExecutions.get(fixtureId) ?? []).slice(-200),
    };
  }

  private writeAnalystExport(fixtureId: string, result: EngineResult): void {
    const sheet = grade(result, this.policy);
    const output: AnalystExport = {
      fixtureId,
      generatedAtMsgId: sheet.generatedAtMsgId,
      decisions: result.ledger.all(),
      radarEvents: result.radarEvents,
      grade: sheet,
      finalScore: result.finalScore,
    };
    const path = join(CORPUS_DIR, `${fixtureId}.analyst.json`);
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(output), "utf8");
    renameSync(temp, path);
  }

  private publish(): void {
    const snapshot = this.snapshot();
    mkdirSync(CORPUS_DIR, { recursive: true });
    const path = join(CORPUS_DIR, "live-state.json");
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(snapshot), "utf8");
    renameSync(temp, path);
    for (const listener of this.listeners) listener(snapshot);
  }
}
