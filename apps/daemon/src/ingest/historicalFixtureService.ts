import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ARCHIVE_REPLAY_TOKEN = "tissue-archive-replay";

interface FixtureIndexRow {
  readonly fixtureId: number;
  readonly directory: string;
  readonly kickoff: number;
  readonly terminalSequence: number | null;
  readonly historicalRecordCount: number;
}

export interface HistoricalFixtureIndex {
  readonly fixtureCount: number;
  readonly startedFixtureCount: number;
  readonly completedFixtureCount: number;
  readonly focusFixtureId: number;
  readonly capturedAt: string;
  readonly fixtures: readonly FixtureIndexRow[];
}

interface Provenance {
  readonly byteLength: number;
  readonly sha256: string;
  readonly path?: string;
  readonly status?: number;
}

export function historicalFixtureRoot(): string {
  return process.env.TISSUE_HISTORICAL_FIXTURE_DIR
    ? resolve(process.env.TISSUE_HISTORICAL_FIXTURE_DIR)
    : fileURLToPath(new URL("../../../../../resources/fixtures/world-cup-2026/", import.meta.url));
}

export function loadHistoricalFixtureIndex(root = historicalFixtureRoot()): HistoricalFixtureIndex {
  return JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as HistoricalFixtureIndex;
}

/** Read only bytes whose adjacent capture provenance still matches. */
export function readVerifiedCapture(path: string): { readonly bytes: Buffer; readonly provenance: Provenance } {
  const provenancePath = `${path}.provenance.json`;
  if (!existsSync(provenancePath)) throw new Error(`capture provenance missing: ${provenancePath}`);
  const bytes = readFileSync(path);
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as Provenance;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== provenance.byteLength || sha256 !== provenance.sha256) {
    throw new Error(`capture integrity mismatch: ${path}`);
  }
  if (provenance.status !== undefined && provenance.status !== 200) {
    throw new Error(`capture was not successful: ${path} (${provenance.status})`);
  }
  return { bytes, provenance };
}

function send(res: ServerResponse, status: number, contentType: string, body: Buffer | string, sha256?: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...(sha256 ? { "x-tissue-capture-sha256": sha256 } : {}),
  });
  res.end(body);
}

function capturedAsOf(path: string): number | undefined {
  const provenance = JSON.parse(readFileSync(`${path}.provenance.json`, "utf8")) as Provenance;
  if (!provenance.path) return undefined;
  const url = new URL(provenance.path, "http://archive.invalid");
  const raw = url.searchParams.get("asOf");
  return raw === null ? undefined : Number(raw);
}

function closestOddsCapture(directory: string, asOf?: number): string {
  const paths = readdirSync(directory)
    .filter((name) => /^odds\.(prematch|firstHalf|secondHalf|postMatch)\.json$/.test(name))
    .map((name) => join(directory, name));
  if (paths.length === 0) throw new Error(`no captured odds snapshots in ${directory}`);
  if (asOf === undefined) {
    return paths.find((path) => basename(path) === "odds.prematch.json") ?? paths[0]!;
  }
  return paths
    .map((path) => ({ path, distance: Math.abs((capturedAsOf(path) ?? asOf) - asOf) }))
    .sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))[0]!.path;
}

export function createHistoricalFixtureServer(root = historicalFixtureRoot()): Server {
  const index = loadHistoricalFixtureIndex(root);
  const directories = new Map(index.fixtures.map((row) => [String(row.fixtureId), join(root, row.directory)]));

  return createServer((req, res) => {
    try {
      if (req.method !== "GET") return send(res, 405, "application/json", JSON.stringify({ error: "method not allowed" }));
      const url = new URL(req.url ?? "/", "http://archive.invalid");
      if (url.pathname === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true, mode: "verified-historical-replay" }));
      if (
        req.headers.authorization !== `Bearer ${ARCHIVE_REPLAY_TOKEN}`
        || req.headers["x-api-token"] !== ARCHIVE_REPLAY_TOKEN
      ) return send(res, 401, "application/json", JSON.stringify({ error: "archive replay authorization required" }));

      if (url.pathname === "/api/fixtures/snapshot") {
        const capture = readVerifiedCapture(join(root, "fixtures.snapshot.json"));
        return send(res, 200, "application/json", capture.bytes, capture.provenance.sha256);
      }

      const match = url.pathname.match(/^\/api\/(scores\/(?:historical|snapshot)|odds\/snapshot)\/(\d+)$/);
      if (!match) return send(res, 404, "application/json", JSON.stringify({ error: "not found" }));
      const fixtureId = match[2]!;
      const directory = directories.get(fixtureId);
      if (!directory) return send(res, 404, "application/json", JSON.stringify({ error: `fixture ${fixtureId} not captured` }));

      let path: string;
      let contentType: string;
      if (match[1] === "scores/historical") {
        const ssePath = join(directory, "scores.historical.sse");
        const intervalsPath = join(directory, "scores.historical-intervals.json");
        // TxLINE's rolling historical SSE window is empty for older matches. The capture
        // workspace separately archived the same authenticated updates in five-minute
        // intervals; serve that SHA-verified aggregate rather than pretending an empty SSE
        // is a complete transcript.
        if (existsSync(ssePath) && readFileSync(ssePath).byteLength > 0) {
          path = ssePath;
          contentType = "text/event-stream";
        } else if (existsSync(intervalsPath)) {
          path = intervalsPath;
          contentType = "application/json";
        } else {
          path = join(directory, "scores.snapshot.json");
          contentType = "application/json";
        }
      } else if (match[1] === "scores/snapshot") {
        path = join(directory, "scores.snapshot.json");
        contentType = "application/json";
      } else {
        const rawAsOf = url.searchParams.get("asOf");
        const asOf = rawAsOf === null ? undefined : Number(rawAsOf);
        if (asOf !== undefined && !Number.isFinite(asOf)) {
          return send(res, 400, "application/json", JSON.stringify({ error: "asOf must be finite milliseconds" }));
        }
        path = closestOddsCapture(directory, asOf);
        contentType = "application/json";
      }
      const capture = readVerifiedCapture(path);
      return send(res, 200, contentType, capture.bytes, capture.provenance.sha256);
    } catch (error) {
      return send(res, 500, "application/json", JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

export async function listenHistoricalFixtureServer(
  root = historicalFixtureRoot(),
): Promise<{ readonly server: Server; readonly origin: string }> {
  const server = createHistoricalFixtureServer(root);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("historical fixture server did not bind a TCP port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
