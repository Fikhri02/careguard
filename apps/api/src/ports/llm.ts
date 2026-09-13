import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

export interface LlmRequest {
  system: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
}

export interface Llm {
  complete(request: LlmRequest): Promise<ChatCompletionMessage>;
}
