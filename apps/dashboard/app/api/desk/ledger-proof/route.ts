export const dynamic = "force-dynamic";

const DAEMON_URL = process.env.TISSUE_DAEMON_URL ?? "http://127.0.0.1:8788";

/** Same-origin proxy of the daemon's Merkle inclusion-proof endpoint (/ledger/proof). Data
 *  assembly only — the browser verifies the proof and the anchored root's on-chain
 *  transaction independently; see components/VerifyPanel.tsx. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get("fixtureId");
  const seq = searchParams.get("seq");
  if (!fixtureId || !seq) {
    return Response.json({ available: false, reason: "fixtureId and seq are required" }, { status: 400 });
  }
  try {
    const upstream = await fetch(
      `${DAEMON_URL}/ledger/proof?fixtureId=${encodeURIComponent(fixtureId)}&seq=${encodeURIComponent(seq)}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
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
