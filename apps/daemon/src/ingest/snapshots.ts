import type { FeedMessage, Network, OddsMessage, ScoreMessage } from "@tissue/shared";
import { type AuthCredentials, authHeaders } from "./txlineAuth.js";
import { normalizeOdds, normalizeScores } from "./normalize.js";

/**
 * Snapshot / historical fetchers for corpus seeding (Phase 1.3). Paths confirmed from
 * the sponsor scripts (GROUND-TRUTH.md §3):
 *   scores snapshot   GET {origin}/api/scores/snapshot/{fixtureId}[?asOf=ms]
 *   odds   snapshot   GET {origin}/api/odds/snapshot/{fixtureId}[?asOf=ms]
 *   scores historical GET {origin}/api/scores/historical/{fixtureId}  (2wk–6h window)
 */

async function getJson(url: string, creds: AuthCredentials): Promise<unknown[]> {
  const res = await fetch(url, { headers: authHeaders(creds) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [body];
}

export async function fetchScoresSnapshot(
  origin: string,
  creds: AuthCredentials,
  fixtureId: string,
  asOfMs?: number,
): Promise<FeedMessage[]> {
  const q = asOfMs != null ? `?asOf=${asOfMs}` : "";
  const rows = await getJson(`${origin}/api/scores/snapshot/${fixtureId}${q}`, creds);
  return rows
    .map((r) => normalizeScores(r as Record<string, unknown>, creds.network))
    .filter((m): m is ScoreMessage => m !== null);
}

export async function fetchOddsSnapshot(
  origin: string,
  creds: AuthCredentials,
  fixtureId: string,
  asOfMs?: number,
): Promise<FeedMessage[]> {
  const q = asOfMs != null ? `?asOf=${asOfMs}` : "";
  const rows = await getJson(`${origin}/api/odds/snapshot/${fixtureId}${q}`, creds);
  return rows
    .map((r) => normalizeOdds(r as Record<string, unknown>, creds.network))
    .filter((m): m is OddsMessage => m !== null);
}

export async function fetchScoresHistorical(
  origin: string,
  creds: AuthCredentials,
  fixtureId: string,
  network: Network = creds.network,
): Promise<FeedMessage[]> {
  const rows = await getJson(`${origin}/api/scores/historical/${fixtureId}`, creds);
  return rows
    .map((r) => normalizeScores(r as Record<string, unknown>, network))
    .filter((m): m is ScoreMessage => m !== null);
}

/** Order a mixed set of feed messages by feed ts, then msgId (stable, deterministic). */
export function orderByFeed(msgs: FeedMessage[]): FeedMessage[] {
  return [...msgs].sort((a, b) => (a.ts - b.ts) || (a.msgId < b.msgId ? -1 : a.msgId > b.msgId ? 1 : 0));
}
