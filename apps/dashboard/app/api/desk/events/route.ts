export const dynamic = "force-dynamic";

const DAEMON_URL = process.env.TISSUE_DAEMON_URL ?? "http://127.0.0.1:8788";

export async function GET(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${DAEMON_URL}/events`, {
      cache: "no-store",
      headers: { accept: "text/event-stream" },
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `Tissue daemon event stream returned HTTP ${upstream.status}` },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return Response.json(
      { error: "Tissue daemon event stream is unavailable" },
      { status: 502 },
    );
  }
}
