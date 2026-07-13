import type { FeedMessage, Network } from "@tissue/shared";
import { SseFrameParser } from "./sseParser.js";
import { FeedHealthTracker } from "./feedHealth.js";
import { type AuthCredentials, authHeaders } from "./txlineAuth.js";
import { normalizeOdds, normalizeScores } from "./normalize.js";

/**
 * Dual SSE client (scores + odds) over native fetch streaming. Reconnect with capped
 * exponential backoff, Last-Event-ID resume, 401/403 → renew-JWT hook, msg-id dedupe and
 * heartbeat gap detection via FeedHealthTracker. One instance per (network, stream).
 */

export type StreamKind = "scores" | "odds";

export interface SseClientOptions {
  readonly origin: string;
  readonly network: Network;
  readonly stream: StreamKind;
  readonly maxGapMs: number;
  readonly softStaleMs: number;
  getCreds(): AuthCredentials;
  renewJwt(): Promise<void>;
  onMessage(msg: FeedMessage): void;
  onGap(gapMs: number): void;
  onError(error: Error): void;
  /** Injected clock — real Date.now() in prod, a fake in tests. */
  now?(): number;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const CONNECT_TIMEOUT_MS = 20_000;

export class SseClient {
  private stopped = false;
  private attempt = 0;
  private lastEventId: string | undefined;
  private readonly health: FeedHealthTracker;
  private activeController: AbortController | undefined;
  private wakeBackoff: (() => void) | undefined;

  constructor(private readonly opts: SseClientOptions) {
    this.health = new FeedHealthTracker(opts.network, opts.maxGapMs, opts.softStaleMs);
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private path(): string {
    return this.opts.stream === "scores" ? "/api/scores/stream" : "/api/odds/stream";
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        this.attempt = 0;
      } catch (err) {
        if (this.stopped) break;
        const error = err instanceof Error ? err : new Error(String(err));
        this.opts.onError(error);
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
          try {
            await this.opts.renewJwt();
          } catch (renewalError) {
            this.opts.onError(new Error(
              `JWT renewal failed: ${renewalError instanceof Error ? renewalError.message : String(renewalError)}`,
            ));
          }
        }
        const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
        this.attempt++;
        await this.backoff(delay);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.activeController?.abort();
    this.wakeBackoff?.();
  }

  private async connectOnce(): Promise<void> {
    const headers: Record<string, string> = {
      ...authHeaders(this.opts.getCreds()),
      accept: "text/event-stream",
      "cache-control": "no-cache",
    };
    if (this.lastEventId) headers["last-event-id"] = this.lastEventId;

    const controller = new AbortController();
    this.activeController = controller;
    let connectTimedOut = false;
    const connectTimer = setTimeout(() => {
      connectTimedOut = true;
      controller.abort();
    }, CONNECT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.opts.origin}${this.path()}`, { headers, signal: controller.signal });
    } catch (error) {
      if (connectTimedOut) throw new Error(`SSE connection timed out after ${CONNECT_TIMEOUT_MS}ms`);
      throw error;
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res.ok || !res.body) {
      throw Object.assign(new Error(`SSE ${res.status}`), { status: res.status });
    }
    this.health.mark(this.now());

    // Independent watchdog: `reader.read()` blocks during a silent feed, so gap detection
    // MUST NOT rely on frame arrival. This timer checks liveness on its own cadence and
    // fires onGap while the read loop is parked. (V4 fix — the same check-before-mark bug
    // class the engine had; here it also needed a watchdog for the blocking-read case.)
    const watchdog = setInterval(() => {
      this.checkGap();
    }, Math.max(250, Math.floor(this.opts.maxGapMs / 2)));

    const parser = new SseFrameParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        const nowMs = this.now();
        // CHECK the gap since last activity BEFORE recording this frame's activity —
        // marking first would erase the very gap we need to detect.
        this.checkGap(nowMs);
        const frames = parser.push(decoder.decode(value, { stream: true }));
        for (const frame of frames) {
          if (frame.heartbeat || frame.data === "") continue; // liveness only
          this.handleData(frame.id, frame.data);
        }
        this.health.mark(nowMs); // record activity AFTER the gap check
      }
    } finally {
      clearInterval(watchdog);
      if (this.activeController === controller) this.activeController = undefined;
      reader.releaseLock();
    }
  }

  /** Emit onGap if the feed has been silent past max_gap_ms. Idempotent; safe to over-call. */
  private checkGap(nowMs: number = this.now()): void {
    const v = this.health.verdict(nowMs);
    if (v.gapHalt) this.opts.onGap(v.gapMs);
  }

  private handleData(id: string | undefined, data: string): void {
    if (id) this.lastEventId = id;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.opts.onError(new Error(`${this.opts.stream} SSE emitted a non-JSON data frame`));
      return;
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      const rec = row as Record<string, unknown>;
      const msg =
        this.opts.stream === "scores"
          ? normalizeScores(rec, this.opts.network)
          : normalizeOdds(rec, this.opts.network);
      if (!msg) continue;
      if (!this.health.accept(msg.msgId)) continue;
      this.opts.onMessage(msg);
    }
  }

  private backoff(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        if (this.wakeBackoff === done) this.wakeBackoff = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakeBackoff = done;
      if (this.stopped) done();
    });
  }
}
