import { describe, expect, it } from "vitest";
import { LatencyHistogram } from "./latencyHistogram.js";

describe("LatencyHistogram — cumulative Prometheus-style buckets", () => {
  it("counts an observation into every bucket it fits under (cumulative, le semantics)", () => {
    const h = new LatencyHistogram([10, 50, 100]);
    h.observe(5);
    const text = h.renderPrometheus("test_latency_ms", "test");
    expect(text).toContain('test_latency_ms_bucket{le="10"} 1');
    expect(text).toContain('test_latency_ms_bucket{le="50"} 1');
    expect(text).toContain('test_latency_ms_bucket{le="100"} 1');
    expect(text).toContain('test_latency_ms_bucket{le="+Inf"} 1');
  });

  it("an observation above every bound only lands in +Inf", () => {
    const h = new LatencyHistogram([10, 50]);
    h.observe(1000);
    const text = h.renderPrometheus("test_latency_ms", "test");
    expect(text).toContain('test_latency_ms_bucket{le="10"} 0');
    expect(text).toContain('test_latency_ms_bucket{le="50"} 0');
    expect(text).toContain('test_latency_ms_bucket{le="+Inf"} 1');
  });

  it("accumulates sum and count across multiple observations", () => {
    const h = new LatencyHistogram([100]);
    h.observe(10);
    h.observe(20);
    h.observe(30);
    const text = h.renderPrometheus("test_latency_ms", "test");
    expect(text).toContain("test_latency_ms_sum 60");
    expect(text).toContain("test_latency_ms_count 3");
  });

  it("rejects non-increasing bucket boundaries rather than silently misbehaving", () => {
    expect(() => new LatencyHistogram([50, 50])).toThrow();
    expect(() => new LatencyHistogram([50, 10])).toThrow();
    expect(() => new LatencyHistogram([])).toThrow();
  });
});
