import type { ChatCompletionMessageParam, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { Clock } from "../../ports/clock.js";
import type { ConversationRepo } from "./repo.js";

export const HISTORY_LIMIT = 30;
export const PHOTO_PLACEHOLDER = "[photo]";

export interface ConversationService {
  /** Returns false when this external message id was already stored (a Twilio retry). */
  appendInbound(elderId: string, message: ChatCompletionUserMessageParam, externalId?: string | null): boolean;
  append(elderId: string, messages: ChatCompletionMessageParam[]): void;
  /** The recent history, trimmed so it always starts at a user message. */
  window(elderId: string): ChatCompletionMessageParam[];
}

/** Images are shown to the model for one turn only; history keeps a text placeholder. */
export function stripImages(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  if (message.role !== "user" || typeof message.content === "string") return message;
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "image_url" ? { type: "text" as const, text: PHOTO_PLACEHOLDER } : part,
    ),
  };
}

export function createConversationService({ repo, clock }: { repo: ConversationRepo; clock: Clock }): ConversationService {
  return {
    appendInbound(elderId, message, externalId = null) {
      return repo.insert(elderId, stripImages(message), clock.now().toISOString(), externalId);
    },
    append(elderId, messages) {
      repo.insertMany(elderId, messages.map(stripImages), clock.now().toISOString());
    },
    window(elderId) {
      const recent = repo.recent(elderId, HISTORY_LIMIT);
      const start = recent.findIndex((message) => message.role === "user");
      return start === -1 ? [] : recent.slice(start);
    },
  };
}
