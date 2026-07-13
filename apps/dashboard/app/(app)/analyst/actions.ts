"use server";

/**
 * Server action → the READ-ONLY analyst service (apps/analyst). The analyst runs in its own
 * process holding only a read-only DB handle, fully isolated from the SSE→…→exec decision
 * path. This proxy keeps ANALYST_URL server-side and degrades gracefully when it's offline.
 */

const ANALYST_URL = process.env.ANALYST_URL ?? "http://127.0.0.1:8787";

export interface AnalystAnswer {
  answer: string;
  citations: { seq: number; hash: string; fixtureId: string }[];
  toolCalls: { name: string; args: unknown }[];
  providers: { provider: string; fellBack: boolean }[];
  fallbackFired: boolean;
}

export type AskResult = AnalystAnswer | { error: string };

export async function askAnalyst(question: string): Promise<AskResult> {
  try {
    const res = await fetch(`${ANALYST_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      cache: "no-store",
    });
    if (!res.ok) return { error: `analyst service returned ${res.status}` };
    return (await res.json()) as AnalystAnswer;
  } catch {
    return { error: `analyst offline at ${ANALYST_URL}. Start it with \`pnpm --filter @tissue/analyst serve\`` };
  }
}
