const API_URL = process.env.API_URL ?? "http://localhost:8787";

export const dynamic = "force-dynamic";

/** Pipes the API's server-sent events through this origin without buffering. */
export async function GET(request: Request): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/stream`, {
      headers: { accept: "text/event-stream" },
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("CareGuard API is unreachable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("CareGuard API stream is unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
