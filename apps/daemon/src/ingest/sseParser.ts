/**
 * Minimal, pure Server-Sent-Events frame parser (W3C SSE grammar subset). Pure so it can
 * be unit-tested without a socket. Comment lines (starting `:`) are the TxLINE heartbeat
 * convention and are surfaced as `heartbeat` frames, not dropped, so the gap detector can
 * see liveness even when no data flows (streaming-data.mdx / troubleshooting.mdx).
 */

export interface SseFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
  readonly heartbeat: boolean;
}

export class SseFrameParser {
  private buffer = "";
  private dataLines: string[] = [];
  private id: string | undefined;
  private event: string | undefined;
  private sawComment = false;

  /** Feed a chunk; returns any complete frames it produced. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const rawLine = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      const frame = this.consumeLine(rawLine);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private consumeLine(line: string): SseFrame | null {
    if (line === "") {
      // Dispatch on blank line.
      if (this.dataLines.length === 0 && !this.sawComment) return null;
      const frame: SseFrame = {
        ...(this.id !== undefined ? { id: this.id } : {}),
        ...(this.event !== undefined ? { event: this.event } : {}),
        data: this.dataLines.join("\n"),
        heartbeat: this.dataLines.length === 0 && this.sawComment,
      };
      this.dataLines = [];
      this.event = undefined;
      this.sawComment = false;
      return frame;
    }
    if (line.startsWith(":")) {
      this.sawComment = true;
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "id":
        this.id = value;
        break;
      case "event":
        this.event = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      default:
        break; // ignore unknown fields (e.g. retry)
    }
    return null;
  }
}
