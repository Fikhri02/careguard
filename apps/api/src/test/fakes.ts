import type { Elder } from "@careguard/shared";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import type { ToolContext } from "../agent/tool.js";
import type { Clock } from "../ports/clock.js";
import type { Llm, LlmRequest } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Search, SearchResult } from "../ports/search.js";
import type { UrlReputation } from "../ports/url-reputation.js";

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function fixedClock(iso = "2026-09-13T03:00:00.000Z"): Clock & { set(iso: string): void } {
  let now = new Date(iso);
  return {
    now: () => new Date(now),
    set(next) {
      now = new Date(next);
    },
  };
}

export function testElder(overrides: Partial<Elder> = {}): Elder {
  return {
    id: "eld_1",
    phone: "whatsapp:+60123456789",
    name: "Mak",
    language: null,
    createdAt: "2026-09-13T03:00:00.000Z",
    ...overrides,
  };
}

export function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return { elder: testElder(), messenger: new CapturingMessenger(), clock: fixedClock(), log: silentLogger, ...overrides };
}

export function fakeSearch(results: SearchResult[] = [], delayMs = 0): Search & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(query) {
      queries.push(query);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return results;
    },
  };
}

export function fakeUrlReputation(unsafeUrls: string[] = []): UrlReputation {
  return { isUnsafe: async (url) => unsafeUrls.includes(url) };
}

export function assistantText(content: string): ChatCompletionMessage {
  return { role: "assistant", content, refusal: null };
}

export function assistantToolCall(name: string, args: Record<string, unknown>, id = `call_${name}`): ChatCompletionMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

export type LlmResponder = (request: LlmRequest, callIndex: number) => ChatCompletionMessage | Promise<ChatCompletionMessage>;

export class FakeLlm implements Llm {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly respond: LlmResponder) {}

  static scripted(responses: ChatCompletionMessage[]): FakeLlm {
    return new FakeLlm((_request, index) => {
      const response = responses[index];
      if (!response) throw new Error(`FakeLlm script exhausted at call ${index}`);
      return response;
    });
  }

  async complete(request: LlmRequest): Promise<ChatCompletionMessage> {
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    return this.respond(request, index);
  }
}
