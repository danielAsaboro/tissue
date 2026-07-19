import type { FeedMessage } from "@tissue/shared";
import { loadPolicy, type Policy } from "../config/policy.js";
import {
  ARCHIVE_REPLAY_TOKEN,
  historicalFixtureRoot,
  listenHistoricalFixtureServer,
  loadHistoricalFixtureIndex,
} from "../ingest/historicalFixtureService.js";
import type { AuthCredentials } from "../ingest/txlineAuth.js";
import { splitFixtures } from "./calibrationSplit.js";
import { evaluateCorpus } from "./evaluateReal.js";
import { loadHistoricalCorpusThroughService } from "./evaluateHistoricalFixtures.js";

interface CandidateResult {
  readonly name: string;
  readonly meanBrier: number;
  readonly weightedClvBps: number;
  readonly quotes: number;
  readonly policy: Policy;
}

function evaluateCandidate(
  name: string,
  policy: Policy,
  corpora: readonly { readonly messages: readonly FeedMessage[] }[],
): CandidateResult {
  const rows = corpora.map((corpus) => evaluateCorpus(corpus.messages, policy));
  const clvN = rows.reduce((sum, row) => sum + row.clvN, 0);
  return {
    name,
    meanBrier: rows.reduce((sum, row) => sum + row.brier, 0) / rows.length,
    weightedClvBps: clvN === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.meanClvBps * row.clvN, 0) / clvN),
    quotes: rows.reduce((sum, row) => sum + row.quotes, 0),
    policy,
  };
}

function publicResult(result: CandidateResult): Omit<CandidateResult, "policy"> {
  return { name: result.name, meanBrier: result.meanBrier, weightedClvBps: result.weightedClvBps, quotes: result.quotes };
}

async function main(): Promise<void> {
  const root = historicalFixtureRoot();
  const index = loadHistoricalFixtureIndex(root);
  const completed = index.fixtures.filter((row) => row.terminalSequence !== null);
  const split = splitFixtures(completed.map((row) => String(row.fixtureId)), 0.3);
  const calibration = completed.filter((row) => split.calibration.includes(String(row.fixtureId)));
  const { server, origin } = await listenHistoricalFixtureServer(root);
  const credentials: AuthCredentials = { network: "mainnet", jwt: ARCHIVE_REPLAY_TOKEN, apiToken: ARCHIVE_REPLAY_TOKEN };
  try {
    const corpora = [] as { readonly messages: readonly FeedMessage[] }[];
    for (const fixture of calibration) {
      corpora.push({ messages: await loadHistoricalCorpusThroughService(origin, credentials, String(fixture.fixtureId), fixture.kickoff) });
    }
    let selected = loadPolicy();
    const stages: { stage: string; candidates: ReturnType<typeof publicResult>[]; selected: string }[] = [];

    const rhoResults = [-0.25, -0.2, -0.15, -0.13, -0.1, -0.05, 0, 0.05].map((rho) => {
      const policy: Policy = { ...selected, model: { ...selected.model, dc_rho: rho } };
      return evaluateCandidate(`dc_rho=${rho}`, policy, corpora);
    });
    rhoResults.sort((a, b) => a.meanBrier - b.meanBrier || b.weightedClvBps - a.weightedClvBps);
    selected = rhoResults[0]!.policy;
    stages.push({ stage: "dc_rho", candidates: rhoResults.map(publicResult), selected: rhoResults[0]!.name });

    const pressureResults = [0, 0.06, 0.12, 0.18].map((maxAdjustment) => {
      const policy: Policy = {
        ...selected,
        model: {
          ...selected.model,
          pressure: { ...selected.model.pressure, enabled: maxAdjustment > 0, max_abs_adjustment: maxAdjustment },
        },
      };
      return evaluateCandidate(`pressure_max=${maxAdjustment}`, policy, corpora);
    });
    pressureResults.sort((a, b) => a.meanBrier - b.meanBrier || b.weightedClvBps - a.weightedClvBps);
    selected = pressureResults[0]!.policy;
    stages.push({ stage: "pressure", candidates: pressureResults.map(publicResult), selected: pressureResults[0]!.name });

    const redResults = [
      { offending: 1, opponent: 1 },
      { offending: 0.8, opponent: 1.1 },
      { offending: 0.75, opponent: 1.15 },
      { offending: 0.7, opponent: 1.2 },
    ].map(({ offending, opponent }) => {
      const policy: Policy = {
        ...selected,
        model: {
          ...selected.model,
          red_card: { ...selected.model.red_card, offending_side_attack_mult: offending, opponent_side_attack_mult: opponent },
        },
      };
      return evaluateCandidate(`red=${offending}/${opponent}`, policy, corpora);
    });
    redResults.sort((a, b) => a.meanBrier - b.meanBrier || b.weightedClvBps - a.weightedClvBps);
    selected = redResults[0]!.policy;
    stages.push({ stage: "red_card", candidates: redResults.map(publicResult), selected: redResults[0]!.name });

    const stoppageResults = [
      { fraction: 0, multiplier: 1 },
      { fraction: 0.02, multiplier: 1.1 },
      { fraction: 0.03, multiplier: 1.2 },
      { fraction: 0.05, multiplier: 1.3 },
    ].map(({ fraction, multiplier }) => {
      const policy: Policy = {
        ...selected,
        model: {
          ...selected.model,
          stoppage: { ...selected.model.stoppage, min_fraction: fraction, lambda_mult: multiplier },
        },
      };
      return evaluateCandidate(`stoppage=${fraction}/${multiplier}`, policy, corpora);
    });
    stoppageResults.sort((a, b) => a.meanBrier - b.meanBrier || b.weightedClvBps - a.weightedClvBps);
    selected = stoppageResults[0]!.policy;
    stages.push({ stage: "stoppage", candidates: stoppageResults.map(publicResult), selected: stoppageResults[0]!.name });

    console.log(JSON.stringify({
      source: "calibration-only-sha256-verified-txline-archive",
      calibrationFixtureIds: split.calibration,
      holdoutFixtureIdsNotEvaluated: split.holdout,
      stages,
      selected: {
        dc_rho: selected.model.dc_rho,
        pressure_enabled: selected.model.pressure.enabled,
        pressure_max_abs_adjustment: selected.model.pressure.max_abs_adjustment,
        red_offending: selected.model.red_card.offending_side_attack_mult,
        red_opponent: selected.model.red_card.opponent_side_attack_mult,
        stoppage_min_fraction: selected.model.stoppage.min_fraction,
        stoppage_lambda_mult: selected.model.stoppage.lambda_mult,
      },
    }, null, 2));
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
