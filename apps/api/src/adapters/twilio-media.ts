import type { Logger } from "../ports/logger.js";

/** Downloads an inbound media URL and returns it as a data URL the vision model can read. */
export type MediaFetcher = (url: string) => Promise<string | null>;

export const noMedia: MediaFetcher = async () => null;

export function createTwilioMediaFetcher(
  opts: { accountSid: string; authToken: string; fetch?: typeof fetch; timeoutMs?: number },
  log: Logger,
): MediaFetcher {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64")}`;

  return async (url) => {
    try {
      const res = await doFetch(url, {
        headers: { Authorization: auth },
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        log.warn("media download failed", { status: res.status });
        return null;
      }
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    } catch (err) {
      log.warn("media download error", { error: (err as Error).message });
      return null;
    }
  };
}
