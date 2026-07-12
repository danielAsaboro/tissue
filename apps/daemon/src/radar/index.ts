import type { FeedMessage } from "@tissue/shared";
import type { Policy } from "../config/policy.js";
import { Radar, type RadarOutput } from "./radar.js";

export * from "./percentiles.js";
export * from "./classify.js";
export { Radar } from "./radar.js";
export type { RadarOutput } from "./radar.js";

/** Run an ordered corpus through the Radar and return all events + halts (flushed). */
export function runRadar(corpus: readonly FeedMessage[], policy: Policy): RadarOutput {
  const radar = new Radar(policy);
  let lastTs = 0;
  for (const msg of corpus) {
    radar.observe(msg);
    lastTs = msg.ts;
  }
  radar.flush(lastTs + policy.radar.unexplained_window_ms + 1);
  return radar.all;
}
