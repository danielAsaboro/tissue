import { loadPolicy, type Policy } from "../config/policy.js";
import { sha256Hex } from "../ledger/hash.js";
import { evaluateCorpus, loadRealCorpora } from "./evaluateReal.js";

/**
 * Calibration/holdout split tooling (REMAINING.md item 3: "tune policy only with a
 * documented calibration/holdout split" — previously prose only, no implementation).
 *
 * Deterministic split by sha256(fixtureId), never insertion order or randomness, so the
 * same fixture always lands on the same side across runs (reproducible, auditable in a
 * PR diff). The DISCIPLINE this tool exists to support: look only at the calibration
 * numbers while adjusting policy.toml; run this tool again to check holdout AFTER
 * freezing the policy change, and treat a holdout regression as a real signal the change
 * overfit to calibration, not something to explain away.
 */

export interface CalibrationSplit {
  readonly calibration: readonly string[];
  readonly holdout: readonly string[];
}

/** sha256(fixtureId) mod 100, compared against holdoutFraction*100 — deterministic, stable. */
export function splitFixtures(fixtureIds: readonly string[], holdoutFraction: number): CalibrationSplit {
  if (holdoutFraction <= 0 || holdoutFraction >= 1) {
    throw new Error(`holdoutFraction must be in (0,1); received ${holdoutFraction}`);
  }
  const calibration: string[] = [];
  const holdout: string[] = [];
  const threshold = Math.round(holdoutFraction * 100);
  for (const fixtureId of [...fixtureIds].sort()) {
    const bucket = parseInt(sha256Hex(fixtureId).slice(0, 8), 16) % 100;
    (bucket < threshold ? holdout : calibration).push(fixtureId);
  }
  return { calibration, holdout };
}

interface SideAggregate {
  readonly fixtureIds: readonly string[];
  readonly fixtures: number;
  readonly clvN: number;
  readonly weightedMeanClvBps: number;
  readonly meanBrier: number | null;
}

export interface CalibrationSplitReport {
  readonly holdoutFraction: number;
  readonly calibration: SideAggregate;
  readonly holdout: SideAggregate;
  /** True when either side has fewer than MIN_FIXTURES_FOR_SIGNAL fixtures — the split
   *  ran correctly but the sample is too small to trust the comparison yet. */
  readonly underpowered: boolean;
}

const MIN_FIXTURES_FOR_SIGNAL = 3;

function aggregate(fixtureIds: readonly string[], policy: Policy, corpora: ReturnType<typeof loadRealCorpora>): SideAggregate {
  const rows = fixtureIds.map((fixtureId) => {
    const corpus = corpora.find((c) => c.fixtureId === fixtureId);
    if (!corpus) throw new Error(`fixture ${fixtureId} not found in loaded real corpora`);
    return evaluateCorpus(corpus.messages, policy);
  });
  const clvN = rows.reduce((sum, r) => sum + r.clvN, 0);
  const weightedMeanClvBps = clvN === 0 ? 0 : Math.round(rows.reduce((sum, r) => sum + r.meanClvBps * r.clvN, 0) / clvN);
  return {
    fixtureIds,
    fixtures: rows.length,
    clvN,
    weightedMeanClvBps,
    meanBrier: rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.brier, 0) / rows.length,
  };
}

export function runCalibrationSplit(policy: Policy, holdoutFraction = 0.3): CalibrationSplitReport {
  const corpora = loadRealCorpora();
  if (corpora.length === 0) {
    throw new Error("No real TxLINE corpora found — run the live daemon or live activation capture first.");
  }
  const split = splitFixtures(corpora.map((c) => c.fixtureId), holdoutFraction);
  const calibration = aggregate(split.calibration, policy, corpora);
  const holdout = aggregate(split.holdout, policy, corpora);
  return {
    holdoutFraction,
    calibration,
    holdout,
    underpowered: calibration.fixtures < MIN_FIXTURES_FOR_SIGNAL || holdout.fixtures < MIN_FIXTURES_FOR_SIGNAL,
  };
}

function main(): void {
  const policy = loadPolicy();
  const report = runCalibrationSplit(policy);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), source: "real-txline-corpora-only", ...report }, null, 2));
  if (report.underpowered) {
    console.error(
      `\n[calibration-split] WARNING: underpowered (fewer than ${MIN_FIXTURES_FOR_SIGNAL} fixtures on one side). ` +
      "The split ran correctly; treat any calibration-vs-holdout difference as noise until more real fixtures are captured.",
    );
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
