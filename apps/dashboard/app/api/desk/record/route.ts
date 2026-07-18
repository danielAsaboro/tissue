export const dynamic = "force-dynamic";

const DAEMON_URL = process.env.TISSUE_DAEMON_URL ?? "http://127.0.0.1:8788";

/**
 * Same-origin proxy of the daemon's public record export (/record). This step is NOT the
 * trust-sensitive one — it only assembles data for display and for the browser to recompute
 * against. The decisive check (does an anchored transaction's real on-chain bytes match) is
 * made directly from the browser to a public Solana RPC, bypassing this server entirely —
 * see components/VerifyPanel.tsx.
 */
export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${DAEMON_URL}/record`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ available: false, reason: "Tissue daemon is temporarily unavailable." }, { status: 502 });
  }
}
