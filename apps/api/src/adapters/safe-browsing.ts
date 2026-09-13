import type { Logger } from "../ports/logger.js";
import type { UrlReputation } from "../ports/url-reputation.js";

export function createSafeBrowsing(
  opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number },
  log: Logger,
): UrlReputation {
  const doFetch = opts.fetch ?? fetch;

  return {
    async isUnsafe(url) {
      try {
        const res = await doFetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${opts.apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "careguard", clientVersion: "1.0" },
            threatInfo: {
              threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url }],
            },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          log.warn("safe browsing check failed", { status: res.status });
          return null;
        }
        const data = (await res.json()) as { matches?: unknown[] };
        return Array.isArray(data.matches) && data.matches.length > 0;
      } catch (err) {
        log.warn("safe browsing check error", { error: (err as Error).message });
        return null;
      }
    },
  };
}
