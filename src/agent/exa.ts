// Thin Exa client (sponsor). Docs: https://docs.exa.ai
// Uses the plain fetch API so there are no extra deps.

const EXA_BASE = "https://api.exa.ai";

function key(): string {
  const k = process.env.EXA_API_KEY;
  if (!k) throw new Error("EXA_API_KEY is not set — get one at https://dashboard.exa.ai");
  return k;
}

export interface ExaResult {
  title: string;
  url: string;
  text?: string;
}

/** Neural/keyword web search with page contents. */
export async function exaSearch(query: string, numResults = 5): Promise<ExaResult[]> {
  const res = await fetch(`${EXA_BASE}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key() },
    body: JSON.stringify({
      query,
      numResults,
      type: "auto",
      contents: { text: { maxCharacters: 1200 } },
    }),
  });
  if (!res.ok) throw new Error(`Exa search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { results: ExaResult[] };
  return data.results ?? [];
}

/** One-shot answer with citations — great for "what's the latest on X". */
export async function exaAnswer(query: string): Promise<{ answer: string; citations: ExaResult[] }> {
  const res = await fetch(`${EXA_BASE}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key() },
    body: JSON.stringify({ query, text: true }),
  });
  if (!res.ok) throw new Error(`Exa answer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { answer: string; citations?: ExaResult[] };
  return { answer: data.answer, citations: data.citations ?? [] };
}
