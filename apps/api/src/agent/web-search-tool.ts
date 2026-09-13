import { z } from "zod";
import type { Search } from "../ports/search.js";
import { defineTool, type ToolSet } from "./tool.js";

export function createWebSearchTool(search: Search): ToolSet {
  return {
    web_search: defineTool({
      name: "web_search",
      description:
        "Search the web for current information, e.g. whether an organisation, website or phone number is legitimate.",
      input: z.object({ query: z.string().describe("The search query") }),
      run: async ({ query }) => {
        const results = await search.search(query, 5);
        if (results.length === 0) return "No results found.";
        return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.text ?? "").slice(0, 400)}`).join("\n\n");
      },
    }),
  };
}
