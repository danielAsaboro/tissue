import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalystExport, FeedMessage } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import { appendToCorpus, CORPUS_DIR, readCorpus } from "../ingest/corpus.js";
import { fetchGuestJwt, type AuthCredentials } from "../ingest/txlineAuth.js";
import { SseClient, type StreamKind } from "../ingest/sseClient.js";
import { grade } from "../grader/grader.js";
import { readLedgerJsonl, verifyChain } from "../ledger/ledger.js";
import { createEngineSession, type EngineResult, type EngineSession } from "../replay/engine.js";
import type { LiveConfig } from "./config.js";
import type { DeskSnapshot, FixtureSnapshot, StreamState } from "./types.js";
import { verifyOddsOnChain, type AnchorEvidence } from "../exec/anchorLive.js";
import { verifyScoreOnChain } from "../exec/scoreAnchorLive.js";

type Listener = (snapshot: DeskSnapshot) => void;

export function admittedSourceMessage(message: FeedMessage): FeedMessage {
  if (message.kind === "odds") return message;
  // TxLINE's stat proof authenticates cumulative goals/reds and period, but not the
  // free-kick/shot payload used by the optional pressure heuristic. Keep those
  // unproved event fields out of live pricing; replay research can still evaluate them.
  return { ...message, possession: { home: "none", away: "none" } };
}

export function assertPersistedLedgerPrefix(fixtureId: string, rebuilt: EngineResult): void {
  const ledgerPath = join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`);
  if (!existsSync(ledgerPath)) return;
  let persisted;
  try {
    persisted = readLedgerJsonl(ledgerPath);
  } catch (error) {
    throw new Error(`persisted ledger for ${fixtureId} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
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
export function reconcilePersistedLedger(fixtureId: string, rebuilt: EngineResult): void {
  const path = join(CORPUS_DIR, `${fixtureId}.ledger.jsonl`);
  if (!existsSync(path)) {
    rebuilt.ledger.writeJsonl(path);
    return;
  }
  const persistedLength = readLedgerJsonl(path).length;
  for (const record of rebuilt.ledger.all().slice(persistedLength)) {
    rebuilt.ledger.appendJsonl(path, record);
  }
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
  private readonly tapes = new Map<string, FeedMessage[]>();
  private readonly messageIds = new Map<string, Set<string>>();
  private readonly results = new Map<string, EngineResult>();
  private readonly sessions = new Map<string, EngineSession>();
  private readonly clients: SseClient[] = [];
  private readonly clientLoops: Promise<void>[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly anchorEvidence = new Map<string, AnchorEvidence>();
  private readonly pendingAnchorIds = new Set<string>();
  private readonly proofErrors = new Map<string, string>();
  private readonly securityCounters = {
    streamFailures: 0,
    sourceProofFailures: 0,
    sourceAdmissionFailures: 0,
  };
  private anchorQueue: Promise<void> = Promise.resolve();
  private readonly streams: Record<StreamKind, StreamState> = {
    scores: { connected: false, gapMs: 0, lastActivityAt: null },
    odds: { connected: false, gapMs: 0, lastActivityAt: null },
  };

  constructor(
    private readonly config: LiveConfig,
    credentials: AuthCredentials,
    policy: Policy = loadPolicy(),
  ) {
    this.credentials = credentials;
    this.policy = policy;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.loadAnchorEvidence();
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
    for (const client of this.clients) client.stop();
    await Promise.all(this.clientLoops);
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
      : anyGap
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
      },
      activeFixtureId: this.activeFixtureId,
      fixtures,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  metrics(): Readonly<typeof this.securityCounters> {
    return { ...this.securityCounters };
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
      appendToCorpus(message.fixtureId, message);
      tape.push(message);
      messageIds.add(message.msgId);
      const record = result.ledger.all().at(-1);
      if (!record) throw new Error(`engine produced no decision for ${message.fixtureId}`);
      result.ledger.appendJsonl(join(CORPUS_DIR, `${message.fixtureId}.ledger.jsonl`), record);
      this.results.set(message.fixtureId, result);
      this.activeFixtureId = message.fixtureId;
      this.writeAnalystExport(message.fixtureId, result);
    } catch (error) {
      // The session mutates before durable writes. Discard every derived in-memory view so a
      // subsequent attempt must rebuild from the authoritative on-disk corpus and ledger.
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
    const tape = existsSync(join(CORPUS_DIR, `${fixtureId}.jsonl`)) ? readCorpus(fixtureId) : [];
    const session = createEngineSession(this.policy, this.config.network, {
      feedGapHalt: true,
      simulateFills: false,
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
        this.persistAnchorEvidence(evidence);
        if (!evidence.result) {
          throw new Error(
            `persisted corpus ${fixtureId} source proof ${existing.msgId} failed fresh verification: ${evidence.error ?? evidence.status}`,
          );
        }
      }
      for (const message of tape) session.append(message);
      const rebuilt = session.current();
      assertPersistedLedgerPrefix(fixtureId, rebuilt);
      reconcilePersistedLedger(fixtureId, rebuilt);
      this.results.set(fixtureId, rebuilt);
      this.activeFixtureId ??= fixtureId;
    }
    this.sessions.set(fixtureId, session);
    this.tapes.set(fixtureId, tape);
    this.messageIds.set(fixtureId, messageIds);
    return tape;
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

  private refreshError(): void {
    const errors = [...Object.values(this.streamErrors), ...this.proofErrors.values()];
    this.error = errors.length > 0 ? errors.join("; ") : undefined;
  }

  private queueVerification(stream: StreamKind, message: FeedMessage): void {
    if (this.pendingAnchorIds.has(message.msgId)) return;
    this.pendingAnchorIds.add(message.msgId);
    this.anchorQueue = this.anchorQueue.catch(() => undefined).then(async () => {
      const evidence = await this.verifySource(message, false);
      this.anchorEvidence.set(message.msgId, evidence);
      this.pendingAnchorIds.delete(message.msgId);
      this.persistAnchorEvidence(evidence);
      if (evidence.result) {
        this.proofErrors.delete(message.msgId);
        await this.commitMessage(stream, admittedSourceMessage(message));
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

  private loadAnchorEvidence(): void {
    const legacyPath = join(CORPUS_DIR, "anchor-evidence.json");
    const journalPath = join(CORPUS_DIR, "anchor-evidence.jsonl");
    const rows: unknown[] = [];
    if (existsSync(legacyPath)) {
      try {
        const parsed = JSON.parse(readFileSync(legacyPath, "utf8")) as unknown;
        if (!Array.isArray(parsed)) throw new Error("legacy evidence must be a JSON array");
        rows.push(...parsed);
      } catch (error) {
        throw new Error(`anchor evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (existsSync(journalPath)) {
      try {
        for (const line of readFileSync(journalPath, "utf8").split("\n")) {
          if (line.trim()) rows.push(JSON.parse(line) as unknown);
        }
      } catch (error) {
        throw new Error(`anchor evidence journal is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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

  private persistAnchorEvidence(evidence: AnchorEvidence): void {
    mkdirSync(CORPUS_DIR, { recursive: true });
    appendFileSync(join(CORPUS_DIR, "anchor-evidence.jsonl"), `${JSON.stringify(evidence)}\n`, "utf8");
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
