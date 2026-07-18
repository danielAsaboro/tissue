/**
 * Minimal Prometheus-style histogram — no dependency, matches the manually-built exposition
 * text api/server.ts already emits for counters/gauges. Cumulative buckets (`le`), `_sum`,
 * `_count`, standard format any Prometheus/Grafana scrape understands.
 */

export class LatencyHistogram {
  private readonly bucketCounts: number[];
  private sum = 0;
  private count = 0;

  constructor(private readonly bucketBoundsMs: readonly number[]) {
    if (bucketBoundsMs.length === 0) throw new Error("histogram requires at least one bucket boundary");
    for (let i = 1; i < bucketBoundsMs.length; i++) {
      if (bucketBoundsMs[i]! <= bucketBoundsMs[i - 1]!) throw new Error("histogram bucket bounds must be strictly increasing");
    }
    this.bucketCounts = new Array(bucketBoundsMs.length).fill(0);
  }

  observe(valueMs: number): void {
    this.sum += valueMs;
    this.count += 1;
    for (let i = 0; i < this.bucketBoundsMs.length; i++) {
      if (valueMs <= this.bucketBoundsMs[i]!) this.bucketCounts[i]! += 1;
    }
  }

  renderPrometheus(name: string, help: string): string {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (let i = 0; i < this.bucketBoundsMs.length; i++) {
      lines.push(`${name}_bucket{le="${this.bucketBoundsMs[i]}"} ${this.bucketCounts[i]}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${name}_sum ${this.sum}`);
    lines.push(`${name}_count ${this.count}`);
    return lines.join("\n");
  }
}

/** ms boundaries covering sub-100ms proof round-trips through multi-second devnet congestion. */
export const DEFAULT_LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
