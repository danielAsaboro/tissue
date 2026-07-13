import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

/**
 * Typed view of policy.toml (PRD §4). Every tunable in the deterministic core resolves
 * through here — no magic numbers in logic. Loading is pure given the file contents, so
 * a fixed policy.toml + a fixed corpus yields a fixed decision chain (replay equality).
 */

export interface Policy {
  readonly schema_version: number;
  readonly markets: {
    readonly markets_enabled: string[];
    readonly in_play_enabled: boolean;
    readonly fixture_focus_mode: string;
  };
  readonly model: {
    readonly dc_rho: number;
    readonly max_goals_per_side: number;
    readonly match_regulation_minutes: number;
    readonly red_card: {
      readonly offending_side_attack_mult: number;
      readonly opponent_side_attack_mult: number;
    };
    readonly pressure: {
      readonly enabled: boolean;
      readonly max_abs_adjustment: number;
      readonly decay_half_life_ms: number;
      readonly attack_weight: number;
      readonly danger_weight: number;
      readonly high_danger_weight: number;
    };
  };
  readonly strategy: {
    readonly edge_threshold_bps: number;
    readonly base_spread_bps: number;
    readonly stale_spread_bps_per_sec: number;
    readonly gamma_inventory: number;
    readonly radar_conditioning: {
      readonly aggressive_classes: string[];
      readonly widen_classes: string[];
      readonly halt_classes: string[];
      readonly aggressive_spread_mult: number;
      readonly widen_spread_mult: number;
    };
  };
  readonly sizing: {
    readonly kelly_fraction: number;
    readonly min_stake_units: number;
    readonly max_stake_units: number;
  };
  readonly risk: {
    readonly exposure_cap_per_market_units: number;
    readonly exposure_cap_per_fixture_units: number;
    readonly max_open_intents: number;
    readonly drawdown_kill_units: number;
    readonly model_divergence_band_bps: number;
  };
  readonly feed: {
    readonly max_gap_ms: number;
    readonly in_play_requires_realtime: boolean;
    readonly soft_stale_ms: number;
  };
  readonly radar: {
    readonly unexplained_window_ms: number;
    readonly significant_reaction_bps: number;
    readonly unexplained_bps: number;
    readonly stabilization_rate_bps_per_sec: number;
    readonly stabilization_hold_ms: number;
    readonly overreaction_retrace_pct: number;
    readonly latency_bands_ms: Record<
      string,
      { fast_p: number; slow_p: number; fast_ms: number; slow_ms: number }
    >;
    readonly draw_compression: { watch_after_minute: number; compression_bps: number };
  };
  readonly exec: {
    readonly book_mode: "simulated" | "onchain";
    readonly anchor_mode: string;
    readonly intent_ttl_ms: number;
    readonly priority_fee_ladder_microlamports: number[];
    readonly tx_max_retries: number;
    readonly anchor_sample_rate: number;
  };
  readonly grader: {
    readonly clv_reference: string;
    readonly brier_calibration_bins: number;
  };
  readonly replay: {
    readonly speeds: number[];
  };
}

const DEFAULT_POLICY_PATH = fileURLToPath(
  new URL("../../../../policy.toml", import.meta.url),
);

export function loadPolicyFromString(toml: string): Policy {
  const parsed = parseToml(toml) as unknown as Policy;
  validatePolicy(parsed);
  return parsed;
}

export function loadPolicy(path: string = DEFAULT_POLICY_PATH): Policy {
  return loadPolicyFromString(readFileSync(path, "utf8"));
}

/** Fail loudly on a malformed policy — a silent default here corrupts every decision. */
function validatePolicy(p: Policy): void {
  const problems: string[] = [];
  if (p.schema_version !== 1) problems.push(`unexpected schema_version ${p.schema_version}`);
  if (!(p.model.dc_rho > -1 && p.model.dc_rho < 1)) problems.push("model.dc_rho out of (-1,1)");
  if (p.model.max_goals_per_side < 3) problems.push("model.max_goals_per_side too small");
  if (p.sizing.kelly_fraction <= 0 || p.sizing.kelly_fraction > 1)
    problems.push("sizing.kelly_fraction must be in (0,1]");
  if (p.model.pressure.max_abs_adjustment < 0 || p.model.pressure.max_abs_adjustment >= 1)
    problems.push("model.pressure.max_abs_adjustment must be in [0,1)");
  if (p.feed.max_gap_ms <= 0) problems.push("feed.max_gap_ms must be > 0");
  if (problems.length) throw new Error(`Invalid policy.toml: ${problems.join("; ")}`);
}
