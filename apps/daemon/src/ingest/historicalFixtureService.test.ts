import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_REPLAY_TOKEN,
  listenHistoricalFixtureServer,
} from "./historicalFixtureService.js";
import { fetchOddsSnapshot, fetchScoresHistorical } from "./snapshots.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function captured(path: string, body: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(path, body, "utf8");
  writeFileSync(`${path}.provenance.json`, JSON.stringify({
    byteLength: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
    status: 200,
    path: "/captured",
    ...extra,
  }), "utf8");
}

function archive(): { root: string; scorePath: string } {
  const root = mkdtempSync(join(tmpdir(), "tissue-history-"));
  roots.push(root);
  const directory = join(root, "7-home-vs-away");
  mkdirSync(directory);
  writeFileSync(join(root, "index.json"), JSON.stringify({
    fixtureCount: 1, startedFixtureCount: 1, completedFixtureCount: 1,
    focusFixtureId: 7, capturedAt: "2026-01-01T00:00:00.000Z",
    fixtures: [{ fixtureId: 7, directory: "7-home-vs-away", kickoff: 1_000, terminalSequence: 2, historicalRecordCount: 2 }],
  }), "utf8");
  captured(join(root, "fixtures.snapshot.json"), "[]");
  captured(join(directory, "scores.historical.sse"), "");
  const scorePath = join(directory, "scores.historical-intervals.json");
  captured(scorePath, JSON.stringify([
    { FixtureId: 7, Seq: 1, Ts: 1_000, StatusId: 2, Clock: { Seconds: 60 }, Stats: {} },
    { FixtureId: 7, Seq: 2, Ts: 2_000, StatusId: 5, Clock: { Seconds: 5_400 }, Stats: { 1: 1, 2: 0 } },
  ]), { status: undefined, path: undefined });
  captured(join(directory, "scores.snapshot.json"), "[]");
  captured(join(directory, "odds.prematch.json"), JSON.stringify([{
    FixtureId: 7, MessageId: "o1", Ts: 900, SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"], Prices: [2000, 3000, 4000], InRunning: false,
  }]), { path: "/api/odds/snapshot/7?asOf=900" });
  return { root, scorePath };
}

describe("verified historical fixture HTTP service", () => {
  it("requires archive authorization and feeds captured score/odds bytes through production fetchers", async () => {
    const { root } = archive();
    const { server, origin } = await listenHistoricalFixtureServer(root);
    try {
      expect((await fetch(`${origin}/api/scores/historical/7`)).status).toBe(401);
      const credentials = { network: "mainnet" as const, jwt: ARCHIVE_REPLAY_TOKEN, apiToken: ARCHIVE_REPLAY_TOKEN };
      const scores = await fetchScoresHistorical(origin, credentials, "7");
      const odds = await fetchOddsSnapshot(origin, credentials, "7", 900);
      expect(scores).toHaveLength(2);
      expect(scores[1]).toMatchObject({ kind: "score", isFinal: true, homeScore: 1, minute: 90 });
      expect(odds).toHaveLength(1);
      expect(odds[0]).toMatchObject({ kind: "odds", marketKey: { market: "1X2" } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails closed when captured bytes no longer match provenance", async () => {
    const { root, scorePath } = archive();
    const { server, origin } = await listenHistoricalFixtureServer(root);
    try {
      writeFileSync(scorePath, "[]", "utf8");
      const response = await fetch(`${origin}/api/scores/historical/7`, {
        headers: { authorization: `Bearer ${ARCHIVE_REPLAY_TOKEN}`, "x-api-token": ARCHIVE_REPLAY_TOKEN },
      });
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("capture integrity mismatch");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
