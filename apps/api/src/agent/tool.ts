import type { Elder } from "@careguard/shared";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import type { Clock } from "../ports/clock.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";

/** Everything a tool may know about the current turn. There is no other per-turn state. */
export interface ToolContext {
  elder: Elder;
  messenger: Messenger;
  clock: Clock;
  log: Logger;
}

export interface Tool {
  schema: ChatCompletionTool;
  run(args: unknown, ctx: ToolContext): Promise<string>;
}

export type ToolSet = Record<string, Tool>;

export interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<string>;
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): Tool {
  const { $schema: _schemaUri, ...parameters } = z.toJSONSchema(def.input) as Record<string, unknown>;

  return {
    schema: { type: "function", function: { name: def.name, description: def.description, parameters } },
    async run(args, ctx) {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return `Invalid arguments for ${def.name}:\n${z.prettifyError(parsed.error)}`;
      return def.run(parsed.data, ctx);
    },
  };
}
