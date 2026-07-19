import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authHeaders } from "../src/ingest/txlineAuth.js";
import { fetchOddsSnapshot, fetchScoresHistorical, fetchScoresSnapshot, orderByFeed } from "../src/ingest/snapshots.js";
import { CORPUS_DIR } from "../src/ingest/corpus.js";
import { loadCredentials, loadLiveConfig } from "../src/runtime/config.js";

/**
 * Bulk real-data extraction across every World Cup fixture, for offline backtesting —
 * distinct from capture:corpus (one fixture at a time, for live-engine corpus seeding).
 * Reuses the same proven fetchers, real credentials, real TxLINE endpoints. Best-effort per
 * fixture: one fixture's failure never aborts the run, and every outcome (success, partial,
 * failure) is recorded in a manifest rather than silently dropped.
 *
 * Usage: TISSUE_MODE=live TISSUE_NETWORK=mainnet TXLINE_JWT=… TXLINE_API_TOKEN=… \
 *   pnpm --filter @tissue/daemon capture:worldcup
 */

const COMPETITION_ID = 72;
const ARCHIVE_DIR = process.env.TISSUE_WORLDCUP_ARCHIVE_DIR ?? join(CORPUS_DIR, "worldcup-2026");
const ODDS_SAMPLES = 20;

interface FixtureListing {
  readonly FixtureId: number;
  readonly Participant1: string;
  readonly Participant2: string;
  readonly StartTime: number;
  readonly GameState?: number;
}

interface ManifestRow {
  readonly fixtureId: string;
  readonly participants: string;
  readonly startTime: number;
  readonly scoresMode: "historical" | "snapshot" | "none";
  readonly scoreCount: number;
  readonly oddsCount: number;
  readonly status: "ok" | "partial" | "failed";
  readonly error?: string;
}

async function fetchAllFixtures(origin: string, creds: Awaited<ReturnType<typeof loadCredentials>>): Promise<FixtureListing[]> {
  // 30-day window from startEpochDay; June 1 2026 (epoch day 20605) covers the entire
  // tournament (confirmed by direct probe: 106 fixtures, June 11 -> July 19).
  const url = `${origin}/api/fixtures/snapshot?startEpochDay=20605&competitionId=${COMPETITION_ID}`;
  const res = await fetch(url, { headers: authHeaders(creds), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`fixture discovery failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as FixtureListing[];
}

async function captureFixture(
  origin: string,
  creds: Awaited<ReturnType<typeof loadCredentials>>,
  fixture: FixtureListing,
): Promise<ManifestRow> {
  const fixtureId = String(fixture.FixtureId);
  const base: Pick<ManifestRow, "fixtureId" | "participants" | "startTime"> = {
    fixtureId,
    participants: `${fixture.Participant1} vs ${fixture.Participant2}`,
    startTime: fixture.StartTime,
  };
  try {
    let scores: Awaited<ReturnType<typeof fetchScoresHistorical>> = [];
    let scoresMode: ManifestRow["scoresMode"] = "none";
    try {
      scores = await fetchScoresHistorical(origin, creds, fixtureId);
      if (scores.length > 0) scoresMode = "historical";
    } catch {
      // Outside the 2-week historical window, or not yet started — fall back to snapshot.
    }
    if (scores.length === 0) {
      scores = await fetchScoresSnapshot(origin, creds, fixtureId);
      if (scores.length > 0) scoresMode = "snapshot";
    }

    const inPlayTs = scores.filter((s) => s.kind === "score" && s.minute > 0).map((s) => s.ts).sort((a, b) => a - b);
    const odds: Awaited<ReturnType<typeof fetchOddsSnapshot>> = [];
    if (inPlayTs.length >= 2) {
      const lo = inPlayTs[0]!;
      const hi = inPlayTs[inPlayTs.length - 1]!;
      for (let i = 0; i < ODDS_SAMPLES; i++) {
        const asOf = Math.round(lo + ((hi - lo) * i) / (ODDS_SAMPLES - 1));
        try {
          const batch = await fetchOddsSnapshot(origin, creds, fixtureId, asOf);
          odds.push(...batch);
        } catch {
          // One sample failing (e.g. transient) should not drop the whole fixture.
        }
      }
    } else {
      try {
        const batch = await fetchOddsSnapshot(origin, creds, fixtureId);
        odds.push(...batch);
      } catch {
        // Match hasn't started or odds unavailable — leave odds empty, still archive scores.
      }
    }

    if (scores.length === 0 && odds.length === 0) {
      return { ...base, scoresMode: "none", scoreCount: 0, oddsCount: 0, status: "failed", error: "no scores or odds available" };
    }

    const merged = orderByFeed([...scores, ...odds]);
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    writeFileSync(join(ARCHIVE_DIR, `${fixtureId}.jsonl`), merged.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");

    return {
      ...base,
      scoresMode,
      scoreCount: scores.length,
      oddsCount: odds.length,
      status: scores.length > 0 && odds.length > 0 ? "ok" : "partial",
    };
  } catch (error) {
    return { ...base, scoresMode: "none", scoreCount: 0, oddsCount: 0, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const config = loadLiveConfig();
  const creds = loadCredentials(config);
  console.log(`[worldcup] network=${config.network} origin=${config.origin} archive=${ARCHIVE_DIR}`);

  const fixtures = await fetchAllFixtures(config.origin, creds);
  console.log(`[worldcup] discovered ${fixtures.length} fixtures`);

  const manifestPath = join(ARCHIVE_DIR, "manifest.json");
  const manifest: ManifestRow[] = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestRow[]) : [];
  const done = new Set(manifest.filter((m) => m.status !== "failed").map((m) => m.fixtureId));

  const now = Date.now();
  const past = fixtures.filter((f) => f.StartTime <= now).sort((a, b) => a.StartTime - b.StartTime);
  console.log(`[worldcup] ${past.length} fixtures have started; ${fixtures.length - past.length} still upcoming (skipped)`);

  for (const fixture of past) {
    const fixtureId = String(fixture.FixtureId);
    if (done.has(fixtureId)) {
      console.log(`[worldcup] ${fixtureId} already captured, skipping`);
      continue;
    }
    process.stdout.write(`[worldcup] ${fixtureId} (${fixture.Participant1} vs ${fixture.Participant2})... `);
    const row = await captureFixture(config.origin, creds, fixture);
    console.log(`${row.status} — scores=${row.scoreCount}(${row.scoresMode}) odds=${row.oddsCount}${row.error ? ` — ${row.error}` : ""}`);
    manifest.push(row);
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  const ok = manifest.filter((m) => m.status === "ok").length;
  const partial = manifest.filter((m) => m.status === "partial").length;
  const failed = manifest.filter((m) => m.status === "failed").length;
  console.log(`[worldcup] DONE: ${ok} ok, ${partial} partial, ${failed} failed, manifest at ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error("[worldcup] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
