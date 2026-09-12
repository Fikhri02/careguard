// Tool registry. Each tool = an OpenAI function schema + a runner.
// Add your winning feature here as a new tool — the agent loop picks it up automatically.

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { exaSearch, exaAnswer } from "./exa.js";
import { iphoneTools } from "./iphone/tools.js";
import { scamTools } from "./scam/investigate.js";
import { familyTools } from "./scam/family.js";
import { reminderTools } from "./careguard/reminders.js";

export interface Tool {
  schema: ChatCompletionTool;
  run: (args: any) => Promise<string>;
}

export const tools: Record<string, Tool> = {
  web_search: {
    schema: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the live web for current information and return titles, URLs and snippets. Use for anything recent or factual.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    },
    run: async ({ query }) => {
      const results = await exaSearch(query, 5);
      return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.text ?? "").slice(0, 400)}`)
        .join("\n\n");
    },
  },

  answer_with_citations: {
    schema: {
      type: "function",
      function: {
        name: "answer_with_citations",
        description:
          "Get a synthesized answer to a factual question, backed by web citations. Use when the user wants a direct answer, not a list of links.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to answer" },
          },
          required: ["question"],
        },
      },
    },
    run: async ({ question }) => {
      const { answer, citations } = await exaAnswer(question);
      const cites = citations.map((c, i) => `[${i + 1}] ${c.title} — ${c.url}`).join("\n");
      return `${answer}\n\nSources:\n${cites}`;
    },
  },

  // 👇 EXAMPLE custom tool. Replace with the action your agent should take in
  //    its "somewhere new" surface (create a ticket, control a device, book, etc).
  remember_fact: {
    schema: {
      type: "function",
      function: {
        name: "remember_fact",
        description: "Save a short fact or preference about the user for later in the session.",
        parameters: {
          type: "object",
          properties: { fact: { type: "string" } },
          required: ["fact"],
        },
      },
    },
    run: async ({ fact }) => {
      memory.push(fact);
      return `Saved. I now remember ${memory.length} thing(s).`;
    },
  },
};

// Toy in-memory store for the example tool. Swap for a real DB / Trigger.dev job.
export const memory: string[] = [];

// Merge in the iPhone "repair or sell?" tools (idea A).
Object.assign(tools, iphoneTools);
// Merge in the Scam Guardian tools (investigate + family alerts).
Object.assign(tools, scamTools, familyTools);
// Merge in CareGuard's "Act" tools (reminders).
Object.assign(tools, reminderTools);

export const toolSchemas: ChatCompletionTool[] = Object.values(tools).map((t) => t.schema);
