import { loadPolicy, type Policy } from "../config/policy.js";
import { evaluateCorpus, loadRealCorpora } from "./evaluateReal.js";
import { splitFixtures } from "./calibrationSplit.js";

/**
 * Honest "daily learning," the non-autonomous version. The user asked for something in the
 * direction of a self-improving desk; a nightly job that silently rewrites policy.toml would
 * break the one thing that makes this system auditable — every constant traceable to a human
 * decision in git, never to an opaque overnight mutation (see HANDOFF.md, config/policy.ts).
 * This tool keeps the same idea (learn from real results, adjust policy) but keeps a human in
 * the loop: it evaluates candidate values against the CALIBRATION split ONLY (never holdout —
 * that discipline, from calibrationSplit.ts, is exactly what stops this tool from overfitting
 * itself to noise) and prints ranked suggestions with their evidence. It NEVER writes
 * policy.toml. A human reads the output and decides whether to edit it, same as any other
 * commit.
 */

const MIN_FIXTURES_FOR_SIGNAL = 3;

export interface TuningCandidate {
  readonly value: number;
  readonly clvN: number;
  readonly weightedMeanClvBps: number;
  readonly meanBrier: number | null;
}

export interface TuningSuggestion {
  readonly parameter: string;
  readonly baselineValue: number;
  readonly candidates: readonly TuningCandidate[];
  /** Best-performing candidate by weighted mean CLV among those with clvN > 0 — null when no
   *  candidate produced any graded quotes, or the sample is too small to trust a ranking. */
  readonly suggestedValue: number | null;
  readonly confident: boolean;
  readonly reason: string;
}

export interface TuningReport {
  readonly calibrationFixtureIds: readonly string[];
  readonly holdoutFixtureIds: readonly string[];
  readonly underpowered: boolean;
  readonly suggestions: readonly TuningSuggestion[];
}

function withEdgeThreshold(policy: Policy, edgeThresholdBps: number): Policy {
  return { ...policy, strategy: { ...policy.strategy, edge_threshold_bps: edgeThresholdBps } };
}

/** Grid around the current value — never chosen from outside a sane range around it, so a
 *  suggestion is always "adjust this knob," never "invent an unrelated policy." */
function edgeThresholdGrid(baseline: number): number[] {
  const deltas = [-0.4, -0.2, 0, 0.2, 0.4];
  return [...new Set(deltas.map((d) => Math.max(1, Math.round(baseline * (1 + d)))))].sort((a, b) => a - b);
}

export function suggestTuning(policy: Policy = loadPolicy(), holdoutFraction = 0.3): TuningReport {
  const corpora = loadRealCorpora();
  if (corpora.length === 0) {
    throw new Error("No real TxLINE corpora found — run the live daemon or live activation capture first.");
  }
  const split = splitFixtures(corpora.map((c) => c.fixtureId), holdoutFraction);
  const calibrationCorpora = corpora.filter((c) => split.calibration.includes(c.fixtureId));
  const underpowered = calibrationCorpora.length < MIN_FIXTURES_FOR_SIGNAL;

  const baseline = policy.strategy.edge_threshold_bps;
  const candidates: TuningCandidate[] = edgeThresholdGrid(baseline).map((value) => {
    const candidatePolicy = withEdgeThreshold(policy, value);
    const rows = calibrationCorpora.map((c) => evaluateCorpus(c.messages, candidatePolicy));
    const clvN = rows.reduce((sum, r) => sum + r.clvN, 0);
    const weightedMeanClvBps = clvN === 0
      ? 0
      : Math.round(rows.reduce((sum, r) => sum + r.meanClvBps * r.clvN, 0) / clvN);
    return {
      value,
      clvN,
      weightedMeanClvBps,
      meanBrier: rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.brier, 0) / rows.length,
    };
  });

  const graded = candidates.filter((c) => c.clvN > 0);
  const best = graded.length > 0
    ? graded.reduce((a, b) => (b.weightedMeanClvBps > a.weightedMeanClvBps ? b : a))
    : null;
  const confident = !underpowered && best !== null && best.value !== baseline;

  const suggestion: TuningSuggestion = {
    parameter: "strategy.edge_threshold_bps",
    baselineValue: baseline,
    candidates,
    suggestedValue: best?.value ?? null,
    confident,
    reason: underpowered
      ? `Only ${calibrationCorpora.length} calibration fixture(s) — fewer than ${MIN_FIXTURES_FOR_SIGNAL}. This grid is presented for transparency only; it is NOT a statistically valid comparison and should not be treated as a recommendation until more real fixtures are captured.`
      : best === null
        ? "No candidate produced any graded quotes on the calibration set — no suggestion possible."
        : best.value === baseline
          ? "The current policy value already ranks best on the calibration set among the candidates tried — no change suggested."
          : `Candidate ${best.value}bps ranked best on the calibration set (weighted mean CLV ${best.weightedMeanClvBps}bps vs baseline ${candidates.find((c) => c.value === baseline)?.weightedMeanClvBps ?? "n/a"}bps). Verify against the HOLDOUT split (evaluate:calibration) before committing — this tool never touches holdout data itself.`,
  };

  return {
    calibrationFixtureIds: split.calibration,
    holdoutFixtureIds: split.holdout,
    underpowered,
    suggestions: [suggestion],
  };
}

function main(): void {
  const report = suggestTuning();
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), source: "real-txline-corpora-only, calibration-split-only", ...report }, null, 2));
  console.log(
    "\n[tuning-suggestions] This tool NEVER writes policy.toml. Suggestions are computed against " +
    "the calibration split only (never holdout) and require a human to read, verify against " +
    "`pnpm --filter @tissue/daemon evaluate:calibration`, and manually edit policy.toml if agreed.",
  );
  if (report.underpowered) {
    console.error(`\n[tuning-suggestions] WARNING: underpowered calibration set — see each suggestion's "reason".`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
