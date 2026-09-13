import type { Logger } from "../ports/logger.js";
import type { Search } from "../ports/search.js";

export function createExaSearch(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }, log: Logger): Search {
  const doFetch = opts.fetch ?? fetch;

  return {
    async search(query, numResults) {
      try {
        const res = await doFetch("https://api.exa.ai/search", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": opts.apiKey },
          body: JSON.stringify({ query, numResults, type: "auto", contents: { text: { maxCharacters: 1200 } } }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          log.warn("exa search failed", { status: res.status });
          return [];
        }
        const data = (await res.json()) as { results?: Array<{ title?: string | null; url: string; text?: string }> };
        return (data.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, text: r.text }));
      } catch (err) {
        log.warn("exa search error", { error: (err as Error).message });
        return [];
      }
    },
  };
}
