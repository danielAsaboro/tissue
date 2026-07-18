export const dynamic = "force-dynamic";

const DAEMON_URL = process.env.TISSUE_DAEMON_URL ?? "http://127.0.0.1:8788";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get("fixtureId");
  const qs = fixtureId ? `?fixtureId=${encodeURIComponent(fixtureId)}` : "";
  try {
    const upstream = await fetch(`${DAEMON_URL}/grade-card.svg${qs}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await upstream.arrayBuffer();
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
