import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicy, loadPolicyFromString, validatePolicyForTest } from "./policy.js";

function VALID_TOML(): string {
  const cwdPath = resolve(process.cwd(), "policy.toml");
  const path = existsSync(cwdPath) ? cwdPath : fileURLToPath(new URL("../../../../policy.toml", import.meta.url));
  return readFileSync(path, "utf8");
}

describe("policy validation — fail closed, never silently disable a gate", () => {
  it("loads the real policy.toml cleanly", () => {
    expect(() => loadPolicy()).not.toThrow();
  });

  it("rejects a policy missing a risk field instead of loading it as undefined", () => {
    const toml = VALID_TOML().replace(/max_open_intents\s*=\s*\d+/, "");
    expect(() => loadPolicyFromString(toml)).toThrow(/risk\.max_open_intents is required/);
  });

  it("rejects a policy missing a nested model field (regression: the original gap)", () => {
    const toml = VALID_TOML().replace(/lambda_mult\s*=\s*[\d.]+/, "");
    expect(() => loadPolicyFromString(toml)).toThrow(/model\.stoppage\.lambda_mult is required/);
  });

  it("rejects a wrong-typed field rather than accepting it", () => {
    const toml = VALID_TOML().replace(/in_play_enabled\s*=\s*true/, 'in_play_enabled = "yes"');
    expect(() => loadPolicyFromString(toml)).toThrow(/markets\.in_play_enabled must be a boolean/);
  });

  it("rejects an empty required array (e.g. no markets enabled)", () => {
    const toml = VALID_TOML().replace(/markets_enabled\s*=\s*\[[^\]]*\]/, "markets_enabled = []");
    expect(() => loadPolicyFromString(toml)).toThrow(/markets\.markets_enabled must be a non-empty string\[\]/);
  });

  it("rejects an out-of-range semantic bound even when the shape is correct", () => {
    const toml = VALID_TOML().replace(/kelly_fraction\s*=\s*[\d.]+/, "kelly_fraction = 1.5");
    expect(() => loadPolicyFromString(toml)).toThrow(/sizing\.kelly_fraction must be in \(0,1\]/);
  });

  it("rejects an inconsistent quote-odds band (max <= min)", () => {
    const toml = VALID_TOML().replace(/max_quote_odds_milli\s*=\s*\d+/, "max_quote_odds_milli = 1");
    expect(() => loadPolicyFromString(toml)).toThrow(/max_quote_odds_milli must be > min_quote_odds_milli/);
  });

  it("rejects a malformed latency_bands_ms record entry", () => {
    const toml = VALID_TOML().replace(/fast_p\s*=\s*[\d.]+,\s*/, "");
    expect(() => loadPolicyFromString(toml)).toThrow(/radar\.latency_bands_ms\..*\.fast_p is required/);
  });

  it("exhaustively: deleting ANY top-level section of a real, valid policy fails closed", () => {
    const valid = loadPolicy();
    for (const key of Object.keys(valid)) {
      const mutated = { ...valid } as Record<string, unknown>;
      delete mutated[key];
      expect(() => validatePolicyForTest(mutated), `deleting top-level "${key}" should fail closed`).toThrow();
    }
  });
});
