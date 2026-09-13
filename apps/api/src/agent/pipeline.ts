import type { CareEvent } from "@careguard/shared";
import type { ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { Clock } from "../ports/clock.js";
import type { Llm } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import type { Services } from "../services.js";
import { careguardSystemPrompt } from "./prompts/careguard.js";
import { runTurn } from "./runner.js";
import type { ToolSet } from "./tool.js";
import type { TurnQueue } from "./turn-queue.js";

export const FALLBACK_REPLY = "Maaf, ada masalah sikit. Cuba hantar sekali lagi ya.";

export interface InboundTurn {
  /** Twilio form: `whatsapp:+60…`. */
  phone: string;
  message: ChatCompletionUserMessageParam;
  externalId?: string | null;
  /** Where this turn's messages go: Twilio for real traffic, a CapturingMessenger for simulate/CLI. */
  messenger: Messenger;
  onToolCall?: (name: string, args: unknown) => void;
}

export interface InboundResult {
  status: "replied" | "duplicate" | "failed";
  reply: string | null;
  events: CareEvent[];
}

export interface InboundPipeline {
  handle(turn: InboundTurn): Promise<InboundResult>;
  idle(): Promise<void>;
}

export interface PipelineDeps {
  services: Services;
  tools: ToolSet;
  llm: Llm;
  queue: TurnQueue;
  clock: Clock;
  log: Logger;
  systemPrompt?: (now: Date) => string;
}

export function createInboundPipeline({
  services,
  tools,
  llm,
  queue,
  clock,
  log,
  systemPrompt = careguardSystemPrompt,
}: PipelineDeps): InboundPipeline {
  return {
    handle(turn) {
      const elder = services.elders.findOrCreateByPhone(turn.phone);

      return queue.run(elder.id, async (): Promise<InboundResult> => {
        // Persisted inside the queue so stored order matches turn order (spec §13.2).
        if (!services.conversation.appendInbound(elder.id, turn.message, turn.externalId)) {
          log.info("duplicate inbound message ignored", { elderId: elder.id, externalId: turn.externalId });
          return { status: "duplicate", reply: null, events: [] };
        }

        const startedAt = clock.now().toISOString();
        const history = services.conversation.window(elder.id);
        history[history.length - 1] = turn.message; // this turn sees the photo; stored history keeps "[photo]"

        try {
          const { reply, newMessages } = await runTurn({
            elder,
            system: systemPrompt(clock.now()),
            history,
            tools,
            llm,
            messenger: turn.messenger,
            clock,
            log,
            onToolCall: turn.onToolCall,
          });
          services.conversation.append(elder.id, newMessages);

          const body = reply.trim() || FALLBACK_REPLY;
          if (!(await turn.messenger.send({ to: elder.phone, body }))) log.warn("reply not delivered", { elderId: elder.id });
          return { status: "replied", reply: body, events: services.events.list({ elderId: elder.id, since: startedAt }) };
        } catch (err) {
          log.error("turn failed", { elderId: elder.id, error: err instanceof Error ? err.message : String(err) });
          await turn.messenger.send({ to: elder.phone, body: FALLBACK_REPLY });
          return { status: "failed", reply: FALLBACK_REPLY, events: [] };
        }
      });
    },
    idle: () => queue.idle(),
  };
}
