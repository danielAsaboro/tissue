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
  /** Injected clock — real Date.now() in prod, a fake in tests. */
  now?(): number;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export class SseClient {
  private stopped = false;
  private attempt = 0;
  private lastEventId: string | undefined;
  private readonly health: FeedHealthTracker;

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
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
          await this.opts.renewJwt();
        }
        const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
        this.attempt++;
        await sleep(delay);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async connectOnce(): Promise<void> {
    const headers: Record<string, string> = {
      ...authHeaders(this.opts.getCreds()),
      accept: "text/event-stream",
      "cache-control": "no-cache",
    };
    if (this.lastEventId) headers["last-event-id"] = this.lastEventId;

    const res = await fetch(`${this.opts.origin}${this.path()}`, { headers });
    if (!res.ok || !res.body) {
      throw Object.assign(new Error(`SSE ${res.status}`), { status: res.status });
    }
    this.health.mark(this.now());

    const parser = new SseFrameParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (!this.stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      const frames = parser.push(decoder.decode(value, { stream: true }));
      const nowMs = this.now();
      for (const frame of frames) {
        this.health.mark(nowMs);
        if (frame.heartbeat || frame.data === "") continue;
        this.handleData(frame.id, frame.data);
      }
      const v = this.health.verdict(nowMs);
      if (v.gapHalt) this.opts.onGap(v.gapMs);
    }
  }

  private handleData(id: string | undefined, data: string): void {
    if (id) this.lastEventId = id;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // non-JSON keepalive / banner
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
