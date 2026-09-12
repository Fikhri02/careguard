// The portable agent "brain". Surface-agnostic: give it a message history,
// it runs an OpenAI tool-calling loop and returns the final reply.
// Works with OpenAI directly OR OpenRouter (set OPENAI_BASE_URL).

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { tools, toolSchemas } from "./tools.js";

const SYSTEM_PROMPT = `You are a helpful, action-oriented agent that lives inside the surface the user is already using (Slack, a web app, a device — not a generic chatbot).
- Be concise. Prefer doing over explaining.
- Use tools when they help; cite sources when you searched the web.
- If you don't know something current, search instead of guessing.`;

export interface AgentOptions {
  system?: string;
  maxSteps?: number;
  onToolCall?: (name: string, args: unknown) => void;
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL, // undefined => api.openai.com
  });
  return _client;
}

const MODEL = () => process.env.MODEL || "gpt-4o-mini";

/**
 * Run the agent to completion.
 * @param history full conversation so far (without the system prompt)
 * @returns the assistant's final text reply, plus the updated history
 */
export async function runAgent(
  history: ChatCompletionMessageParam[],
  opts: AgentOptions = {},
): Promise<{ reply: string; history: ChatCompletionMessageParam[] }> {
  const maxSteps = opts.maxSteps ?? 6;
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system ?? SYSTEM_PROMPT },
    ...history,
  ];

  for (let step = 0; step < maxSteps; step++) {
    const completion = await client().chat.completions.create({
      model: MODEL(),
      messages,
      tools: toolSchemas,
      tool_choice: "auto",
    });

    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const reply = msg.content ?? "";
      // Return history without the system message so callers can persist it.
      return { reply, history: messages.slice(1) };
    }

    // Execute each requested tool call and feed results back.
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* leave args empty */
      }
      opts.onToolCall?.(name, args);

      let result: string;
      try {
        const tool = tools[name];
        result = tool ? await tool.run(args) : `Unknown tool: ${name}`;
      } catch (err) {
        result = `Tool "${name}" errored: ${(err as Error).message}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return {
    reply: "I hit the step limit before finishing. Try narrowing the request.",
    history: messages.slice(1),
  };
}

/** Convenience: single-turn ask. */
export async function ask(userText: string, opts?: AgentOptions): Promise<string> {
  const { reply } = await runAgent([{ role: "user", content: userText }], opts);
  return reply;
}
