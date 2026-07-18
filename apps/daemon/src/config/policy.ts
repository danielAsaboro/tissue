import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
    readonly match_extra_time_minutes: number;
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
    readonly stoppage: {
      readonly min_fraction: number;
      readonly lambda_mult: number;
    };
    readonly mutual_danger: {
      /** Decayed pressure scalar (state/matchState.ts, [0,1]) both sides must sustain. */
      readonly pressure_threshold: number;
      /** How long BOTH sides must stay above the threshold before the regime activates. */
      readonly min_duration_ms: number;
    };
  };
  readonly strategy: {
    readonly edge_threshold_bps: number;
    readonly base_spread_bps: number;
    readonly stale_spread_bps_per_sec: number;
    readonly stoppage_spread_mult: number;
    readonly mutual_danger_spread_mult: number;
    readonly mutual_danger_size_mult: number;
    readonly gamma_inventory: number;
    readonly min_quote_odds_milli: number;
    readonly max_quote_odds_milli: number;
    readonly radar_conditioning: {
      readonly aggressive_classes: string[];
      readonly widen_classes: string[];
      readonly halt_classes: string[];
      readonly aggressive_spread_mult: number;
      readonly widen_spread_mult: number;
    };
    /** Sizing by market REGIME (radar/narrative.ts), on top of the per-event radar_conditioning
     *  above: a persistently slow market earns compounded size, a persistently nervous one
     *  earns cut size and wider spread, an oscillating one gets minimum size only. */
    readonly narrative_conditioning: {
      readonly compounding_size_mult: number;
      readonly cautious_spread_mult: number;
      readonly cautious_size_mult: number;
      readonly oscillating_size_mult: number;
    };
    /** Stale-quote decay (strategy/staleQuote.ts, adapted from "Dead Intent Decay" — see
     *  staleQuote.ts for why this tracks Tissue's own resting quote, not an external
     *  orderbook that doesn't exist on the sponsor's devnet program). */
    readonly stale_quote: {
      readonly decay_ms: number;
      readonly min_spread_mult: number;
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
    /** Aggregate cap ACROSS every fixture the desk is concurrently running (one-fixture-focus
     *  is the default PRD scope, but the World Cup runs staggered concurrent knockout ties —
     *  a per-fixture-only cap multiplies uncapped total capital at risk by fixture count). */
    readonly portfolio_exposure_cap_units: number;
    /** Aggregate drawdown kill ACROSS every fixture. Latches like the per-fixture kill
     *  (operator-restart-only) but halts EVERY concurrently running fixture, not just the
     *  one whose loss tripped it. */
    readonly portfolio_drawdown_kill_units: number;
    /** Aggregate proof-failure-rate circuit breaker — distinct from per-message admission
     *  failure (a single bad proof already blocks just that message). If the recent-window
     *  failure rate crosses this threshold, the desk halts entirely: a systemic proof-service
     *  problem, not an isolated bad message. Operator-restart-only, like the other kill
     *  latches — never auto-resumes. */
    readonly proof_failure_window: number;
    readonly proof_failure_min_samples: number;
    readonly proof_failure_rate_halt: number;
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
    readonly narrative: {
      /** Rolling lookback window for regime classification (ms). */
      readonly window_ms: number;
      /** Fraction of in-window events one taxonomy side must hold to dominate. */
      readonly dominance_fraction: number;
      /** Minimum in-window sample count before claiming a non-neutral regime. */
      readonly min_samples: number;
    };
    /** Consensus-based informed-flow signal (informedFlow.ts): a move-VELOCITY check
     *  against this market's own trailing distribution, adapted from Glosten-Milgrom.
     *  Single-stream honest — see informedFlow.ts for why this isn't multi-book VPIN. */
    readonly informed_flow: {
      readonly enabled: boolean;
      readonly toxic_percentile: number;
      readonly min_samples: number;
      readonly seed_velocity_bps_per_sec: number;
    };
  };
  readonly exec: {
    readonly book_mode: "quote_publication";
    readonly anchor_mode: string;
    readonly intent_ttl_ms: number;
    readonly priority_fee_ladder_microlamports: number[];
    readonly tx_max_retries: number;
    readonly anchor_sample_rate: number;
    /** Anchor a checkpoint of the ledger head hash every N decisions (0 disables). Continuous
     *  on-chain evidence through the match, not just at kickoff — see exec/periodicAnchor.ts. */
    readonly checkpoint_interval_decisions: number;
    /** How often the daemon re-checks the anchoring keypair's real SOL balance
     *  (runtime/liveDesk.ts::checkWalletBalance). Anchoring/commit transactions fail
     *  silently-to-the-operator without this — surfaced on /health and /metrics instead. */
    readonly wallet_balance_check_interval_ms: number;
    /** Below this lamport balance, /health and /metrics report a low-balance warning —
     *  anchoring and checkpoint transactions are at real risk of failing for lack of funds. */
    readonly wallet_low_balance_lamports: number;
  };
  readonly grader: {
    readonly clv_reference: string;
    readonly brier_calibration_bins: number;
  };
  readonly replay: {
    readonly speeds: number[];
  };
}

const cwdPolicyPath = resolve(process.cwd(), "policy.toml");
const DEFAULT_POLICY_PATH = process.env.TISSUE_POLICY_PATH
  ?? (existsSync(cwdPolicyPath)
    ? cwdPolicyPath
    : fileURLToPath(new URL("../../../../policy.toml", import.meta.url)));

export function loadPolicyFromString(toml: string): Policy {
  const parsed = parseToml(toml) as unknown as Policy;
  validatePolicy(parsed);
  return parsed;
}

export function loadPolicy(path: string = DEFAULT_POLICY_PATH): Policy {
  return loadPolicyFromString(readFileSync(path, "utf8"));
}

/**
 * Leaf type markers for the recursive shape walk below. "record" is the one dynamic-key
 * exception (radar.latency_bands_ms) — every value under it must itself match the given
 * nested shape.
 */
type Leaf = "number" | "boolean" | "string" | "number[]" | "string[]";
interface RecordSpec {
  readonly kind: "record";
  readonly of: Shape;
}
type Shape = { readonly [k: string]: Leaf | Shape | RecordSpec };

function isRecordSpec(spec: Shape[string]): spec is RecordSpec {
  return typeof spec === "object" && "kind" in spec && spec.kind === "record";
}

/**
 * Exhaustive shape of Policy. A field added to the Policy interface must be added here
 * too, or it silently stops being validated — there is no compiler-enforced link between
 * the two, so policy.test.ts asserts against every top-level section as a regression guard.
 */
const POLICY_SHAPE: Shape = {
  schema_version: "number",
  markets: { markets_enabled: "string[]", in_play_enabled: "boolean", fixture_focus_mode: "string" },
  model: {
    dc_rho: "number",
    max_goals_per_side: "number",
    match_regulation_minutes: "number",
    match_extra_time_minutes: "number",
    red_card: { offending_side_attack_mult: "number", opponent_side_attack_mult: "number" },
    pressure: {
      enabled: "boolean",
      max_abs_adjustment: "number",
      decay_half_life_ms: "number",
      attack_weight: "number",
      danger_weight: "number",
      high_danger_weight: "number",
    },
    stoppage: { min_fraction: "number", lambda_mult: "number" },
    mutual_danger: { pressure_threshold: "number", min_duration_ms: "number" },
  },
  strategy: {
    edge_threshold_bps: "number",
    base_spread_bps: "number",
    stale_spread_bps_per_sec: "number",
    stoppage_spread_mult: "number",
    mutual_danger_spread_mult: "number",
    mutual_danger_size_mult: "number",
    gamma_inventory: "number",
    min_quote_odds_milli: "number",
    max_quote_odds_milli: "number",
    radar_conditioning: {
      aggressive_classes: "string[]",
      widen_classes: "string[]",
      halt_classes: "string[]",
      aggressive_spread_mult: "number",
      widen_spread_mult: "number",
    },
    narrative_conditioning: {
      compounding_size_mult: "number",
      cautious_spread_mult: "number",
      cautious_size_mult: "number",
      oscillating_size_mult: "number",
    },
    stale_quote: { decay_ms: "number", min_spread_mult: "number" },
  },
  sizing: { kelly_fraction: "number", min_stake_units: "number", max_stake_units: "number" },
  risk: {
    exposure_cap_per_market_units: "number",
    exposure_cap_per_fixture_units: "number",
    max_open_intents: "number",
    drawdown_kill_units: "number",
    model_divergence_band_bps: "number",
    portfolio_exposure_cap_units: "number",
    portfolio_drawdown_kill_units: "number",
    proof_failure_window: "number",
    proof_failure_min_samples: "number",
    proof_failure_rate_halt: "number",
  },
  feed: { max_gap_ms: "number", in_play_requires_realtime: "boolean", soft_stale_ms: "number" },
  radar: {
    unexplained_window_ms: "number",
    significant_reaction_bps: "number",
    unexplained_bps: "number",
    stabilization_rate_bps_per_sec: "number",
    stabilization_hold_ms: "number",
    overreaction_retrace_pct: "number",
    latency_bands_ms: {
      kind: "record",
      of: { fast_p: "number", slow_p: "number", fast_ms: "number", slow_ms: "number" },
    },
    draw_compression: { watch_after_minute: "number", compression_bps: "number" },
    narrative: { window_ms: "number", dominance_fraction: "number", min_samples: "number" },
    informed_flow: {
      enabled: "boolean",
      toxic_percentile: "number",
      min_samples: "number",
      seed_velocity_bps_per_sec: "number",
    },
  },
  exec: {
    book_mode: "string",
    anchor_mode: "string",
    intent_ttl_ms: "number",
    priority_fee_ladder_microlamports: "number[]",
    tx_max_retries: "number",
    anchor_sample_rate: "number",
    checkpoint_interval_decisions: "number",
    wallet_balance_check_interval_ms: "number",
    wallet_low_balance_lamports: "number",
  },
  grader: { clv_reference: "string", brier_calibration_bins: "number" },
  replay: { speeds: "number[]" },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkLeaf(kind: Leaf, value: unknown, path: string, problems: string[]): void {
  switch (kind) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${path} must be a finite number`);
      return;
    case "boolean":
      if (typeof value !== "boolean") problems.push(`${path} must be a boolean`);
      return;
    case "string":
      if (typeof value !== "string" || value.length === 0) problems.push(`${path} must be a non-empty string`);
      return;
    case "number[]":
      if (!Array.isArray(value) || value.length === 0 || !value.every((x) => typeof x === "number")) {
        problems.push(`${path} must be a non-empty number[]`);
      }
      return;
    case "string[]":
      if (!Array.isArray(value) || value.length === 0 || !value.every((x) => typeof x === "string")) {
        problems.push(`${path} must be a non-empty string[]`);
      }
      return;
  }
}

function checkShape(shape: Shape, value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) {
    problems.push(`${path} must be an object`);
    return;
  }
  for (const [key, spec] of Object.entries(shape)) {
    const childPath = path ? `${path}.${key}` : key;
    const childValue = value[key];
    if (childValue === undefined || childValue === null) {
      problems.push(`${childPath} is required`);
      continue;
    }
    if (typeof spec === "string") {
      checkLeaf(spec, childValue, childPath, problems);
    } else if (isRecordSpec(spec)) {
      if (!isPlainObject(childValue) || Object.keys(childValue).length === 0) {
        problems.push(`${childPath} must be a non-empty object`);
        continue;
      }
      for (const recordKey of Object.keys(childValue)) {
        checkShape(spec.of, childValue[recordKey], `${childPath}.${recordKey}`, problems);
      }
    } else {
      checkShape(spec, childValue, childPath, problems);
    }
  }
}

/**
 * Fail loudly on a malformed policy — a silent default here corrupts every decision.
 * Two passes: (1) exhaustive shape check against every key the deterministic core reads
 * (a missing field used to load as `undefined` and silently disable risk gates via
 * `NaN > x` always-false comparisons); (2) semantic bounds on the fields where "present and
 * the right type" isn't sufficient (e.g. a probability must be in [0,1]).
 */
/** Exported only for policy.test.ts's exhaustive-section regression guard. */
export function validatePolicyForTest(p: unknown): void {
  validatePolicy(p as Policy);
}

function validatePolicy(p: Policy): void {
  const problems: string[] = [];
  checkShape(POLICY_SHAPE, p as unknown, "", problems);
  if (problems.length) throw new Error(`Invalid policy.toml (shape): ${problems.join("; ")}`);

  if (p.schema_version !== 1) problems.push(`unexpected schema_version ${p.schema_version}`);
  if (!(p.model.dc_rho > -1 && p.model.dc_rho < 1)) problems.push("model.dc_rho out of (-1,1)");
  if (p.model.max_goals_per_side < 3) problems.push("model.max_goals_per_side too small");
  if (p.model.match_regulation_minutes <= 0) problems.push("model.match_regulation_minutes must be > 0");
  if (p.model.match_extra_time_minutes < 0) problems.push("model.match_extra_time_minutes must be >= 0");
  if (p.model.stoppage.min_fraction < 0 || p.model.stoppage.min_fraction > 1)
    problems.push("model.stoppage.min_fraction must be in [0,1]");
  if (p.model.stoppage.lambda_mult < 1) problems.push("model.stoppage.lambda_mult must be >= 1");
  if (p.strategy.stoppage_spread_mult < 1) problems.push("strategy.stoppage_spread_mult must be >= 1");
  if (p.model.mutual_danger.pressure_threshold <= 0 || p.model.mutual_danger.pressure_threshold > 1)
    problems.push("model.mutual_danger.pressure_threshold must be in (0,1]");
  if (p.model.mutual_danger.min_duration_ms < 0)
    problems.push("model.mutual_danger.min_duration_ms must be >= 0");
  if (p.strategy.mutual_danger_spread_mult < 1)
    problems.push("strategy.mutual_danger_spread_mult must be >= 1");
  if (p.strategy.mutual_danger_size_mult <= 0 || p.strategy.mutual_danger_size_mult > 1)
    problems.push("strategy.mutual_danger_size_mult must be in (0,1]");
  if (p.radar.narrative.window_ms <= 0) problems.push("radar.narrative.window_ms must be > 0");
  if (p.radar.narrative.dominance_fraction <= 0.5 || p.radar.narrative.dominance_fraction > 1)
    problems.push("radar.narrative.dominance_fraction must be in (0.5,1]");
  if (p.radar.narrative.min_samples < 1) problems.push("radar.narrative.min_samples must be >= 1");
  if (p.radar.informed_flow.toxic_percentile <= 50 || p.radar.informed_flow.toxic_percentile > 100)
    problems.push("radar.informed_flow.toxic_percentile must be in (50,100]");
  if (p.radar.informed_flow.min_samples < 1) problems.push("radar.informed_flow.min_samples must be >= 1");
  if (p.radar.informed_flow.seed_velocity_bps_per_sec <= 0)
    problems.push("radar.informed_flow.seed_velocity_bps_per_sec must be > 0");
  if (p.strategy.narrative_conditioning.compounding_size_mult < 1)
    problems.push("strategy.narrative_conditioning.compounding_size_mult must be >= 1");
  if (
    p.strategy.narrative_conditioning.cautious_spread_mult < 1
  ) problems.push("strategy.narrative_conditioning.cautious_spread_mult must be >= 1");
  if (
    p.strategy.narrative_conditioning.cautious_size_mult <= 0
    || p.strategy.narrative_conditioning.cautious_size_mult > 1
  ) problems.push("strategy.narrative_conditioning.cautious_size_mult must be in (0,1]");
  if (
    p.strategy.narrative_conditioning.oscillating_size_mult <= 0
    || p.strategy.narrative_conditioning.oscillating_size_mult > 1
  ) problems.push("strategy.narrative_conditioning.oscillating_size_mult must be in (0,1]");
  if (p.strategy.stale_quote.decay_ms <= 0) problems.push("strategy.stale_quote.decay_ms must be > 0");
  if (p.strategy.stale_quote.min_spread_mult <= 0 || p.strategy.stale_quote.min_spread_mult > 1)
    problems.push("strategy.stale_quote.min_spread_mult must be in (0,1]");
  if (p.strategy.min_quote_odds_milli <= 0) problems.push("strategy.min_quote_odds_milli must be > 0");
  if (p.strategy.max_quote_odds_milli <= p.strategy.min_quote_odds_milli)
    problems.push("strategy.max_quote_odds_milli must be > min_quote_odds_milli");
  if (p.sizing.kelly_fraction <= 0 || p.sizing.kelly_fraction > 1)
    problems.push("sizing.kelly_fraction must be in (0,1]");
  if (p.sizing.max_stake_units < p.sizing.min_stake_units)
    problems.push("sizing.max_stake_units must be >= min_stake_units");
  if (p.model.pressure.max_abs_adjustment < 0 || p.model.pressure.max_abs_adjustment >= 1)
    problems.push("model.pressure.max_abs_adjustment must be in [0,1)");
  if (p.risk.max_open_intents <= 0) problems.push("risk.max_open_intents must be > 0");
  if (p.risk.exposure_cap_per_market_units <= 0) problems.push("risk.exposure_cap_per_market_units must be > 0");
  if (p.risk.exposure_cap_per_fixture_units <= 0) problems.push("risk.exposure_cap_per_fixture_units must be > 0");
  if (p.risk.drawdown_kill_units <= 0) problems.push("risk.drawdown_kill_units must be > 0");
  if (p.risk.portfolio_exposure_cap_units < p.risk.exposure_cap_per_fixture_units)
    problems.push("risk.portfolio_exposure_cap_units must be >= risk.exposure_cap_per_fixture_units");
  if (p.risk.portfolio_drawdown_kill_units < p.risk.drawdown_kill_units)
    problems.push("risk.portfolio_drawdown_kill_units must be >= risk.drawdown_kill_units");
  if (p.risk.proof_failure_window <= 0) problems.push("risk.proof_failure_window must be > 0");
  if (p.risk.proof_failure_min_samples <= 0) problems.push("risk.proof_failure_min_samples must be > 0");
  if (p.risk.proof_failure_min_samples > p.risk.proof_failure_window)
    problems.push("risk.proof_failure_min_samples must be <= risk.proof_failure_window");
  if (p.risk.proof_failure_rate_halt <= 0 || p.risk.proof_failure_rate_halt > 1)
    problems.push("risk.proof_failure_rate_halt must be in (0,1]");
  if (p.feed.max_gap_ms <= 0) problems.push("feed.max_gap_ms must be > 0");
  if (p.exec.book_mode !== "quote_publication")
    problems.push(`exec.book_mode must be "quote_publication"; received ${JSON.stringify(p.exec.book_mode)}`);
  if (p.exec.anchor_sample_rate < 0 || p.exec.anchor_sample_rate > 1)
    problems.push("exec.anchor_sample_rate must be in [0,1]");
  if (p.exec.tx_max_retries < 0) problems.push("exec.tx_max_retries must be >= 0");
  if (p.exec.checkpoint_interval_decisions < 0)
    problems.push("exec.checkpoint_interval_decisions must be >= 0");
  if (p.exec.wallet_balance_check_interval_ms <= 0)
    problems.push("exec.wallet_balance_check_interval_ms must be > 0");
  if (p.exec.wallet_low_balance_lamports < 0)
    problems.push("exec.wallet_low_balance_lamports must be >= 0");
  if (p.grader.brier_calibration_bins <= 0) problems.push("grader.brier_calibration_bins must be > 0");
  if (problems.length) throw new Error(`Invalid policy.toml: ${problems.join("; ")}`);
}
