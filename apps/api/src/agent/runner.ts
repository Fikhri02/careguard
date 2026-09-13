import type { Elder } from "@careguard/shared";
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Clock } from "../ports/clock.js";
import type { Llm } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import { toolSchemas } from "./registry.js";
import type { ToolContext, ToolSet } from "./tool.js";

export interface RunTurnInput {
  elder: Elder;
  system: string;
  /** Conversation so far, ending with the elder's new message. */
  history: ChatCompletionMessageParam[];
  tools: ToolSet;
  llm: Llm;
  messenger: Messenger;
  clock: Clock;
  log: Logger;
  maxSteps?: number;
  onToolCall?: (name: string, args: unknown) => void;
}

export interface TurnResult {
  reply: string;
  /** Messages produced this turn (assistant + tool), for the caller to persist. */
  newMessages: ChatCompletionMessageParam[];
}

export const STEP_LIMIT_REPLY =
  "Maaf, saya perlukan sedikit masa lagi. Boleh hantar semula dengan ringkas?\nSorry, could you send that again more simply?";

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const { elder, system, history, tools, llm, messenger, clock, log, maxSteps = 6, onToolCall } = input;
  const ctx: ToolContext = { elder, messenger, clock, log };
  const schemas = toolSchemas(tools);
  const newMessages: ChatCompletionMessageParam[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const message = await llm.complete({ system, messages: [...history, ...newMessages], tools: schemas });
    const toolCalls = message.tool_calls ?? [];
    const assistant: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: message.content,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    newMessages.push(assistant);

    if (toolCalls.length === 0) return { reply: message.content ?? "", newMessages };

    for (const call of toolCalls) {
      const name = call.function.name;
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // Leave args empty; the tool's validation reports what is missing.
      }
      onToolCall?.(name, args);

      let content: string;
      const tool = tools[name];
      if (!tool) {
        content = `Unknown tool: ${name}`;
      } else {
        try {
          content = await tool.run(args, ctx);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          log.error("tool failed", { tool: name, elderId: elder.id, error: detail });
          content = `Tool "${name}" failed: ${detail}`;
        }
      }
      newMessages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { reply: STEP_LIMIT_REPLY, newMessages };
}
