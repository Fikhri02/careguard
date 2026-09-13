import OpenAI from "openai";
import type { Llm } from "../ports/llm.js";

export function createOpenAiLlm(opts: { apiKey: string; baseUrl?: string; model: string; timeoutMs?: number }): Llm {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, timeout: opts.timeoutMs ?? 30_000, maxRetries: 1 });

  return {
    async complete({ system, messages, tools }) {
      const completion = await client.chat.completions.create({
        model: opts.model,
        messages: [{ role: "system", content: system }, ...messages],
        tools,
        tool_choice: "auto",
      });
      const message = completion.choices[0]?.message;
      if (!message) throw new Error("LLM returned no choices");
      return message;
    },
  };
}

/** Used when OPENAI_API_KEY is unset: every turn fails and the elder gets the fallback reply. */
export const disabledLlm: Llm = {
  complete: async () => {
    throw new Error("OPENAI_API_KEY is not set");
  },
};
