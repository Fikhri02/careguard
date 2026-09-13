import type { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { TELEGRAM_PREFIX } from "../../adapters/telegram-messenger.js";
import type { InboundPipeline } from "../../agent/pipeline.js";
import type { EldersService } from "../../modules/elders/service.js";
import type { FamilyService } from "../../modules/family/service.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { ReplyMarkup, TelegramClient, TelegramMessage } from "./client.js";

export const SHARE_BUTTON = "I'm family — share my number";

export const WELCOME =
  "Hai! Saya CareGuard 💙 Hantar gambar bil atau surat, atau forward mesej yang mencurigakan — saya tolong terangkan dan periksa.\n\n" +
  "Hi! I'm CareGuard. Send a photo of a bill or letter, or forward a suspicious message, and I'll explain or check it.\n\n" +
  "Family member? Tap the button below so CareGuard can alert you here.";

const SHARE_KEYBOARD: ReplyMarkup = {
  keyboard: [[{ text: SHARE_BUTTON, request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const REMOVE_KEYBOARD: ReplyMarkup = { remove_keyboard: true };

export interface TelegramPollerDeps {
  client: TelegramClient;
  pipeline: Pick<InboundPipeline, "handle">;
  family: Pick<FamilyService, "linkTelegram">;
  elders: Pick<EldersService, "get">;
  messenger: Messenger;
  log: Logger;
  pollTimeoutSeconds?: number;
  /** Pause after an empty poll that returned too quickly (Telegram unreachable), so the loop can't spin. */
  idleDelayMs?: number;
}

export interface TelegramPoller {
  start(): void;
  stop(): Promise<void>;
  handleMessage(message: TelegramMessage): Promise<void>;
}

/** Long-polls the Bot API, so no public URL or ngrok is needed. */
export function createTelegramPoller(deps: TelegramPollerDeps): TelegramPoller {
  const { client, pipeline, family, elders, messenger, log } = deps;
  const pollTimeoutSeconds = deps.pollTimeoutSeconds ?? 25;
  const idleDelayMs = deps.idleDelayMs ?? 2_000;
  const abort = new AbortController();
  let running = false;
  let offset = 0;
  let loop: Promise<void> | null = null;

  async function linkFamily(chatId: string, message: TelegramMessage): Promise<void> {
    const contact = message.contact!;
    // Only the sender's own contact card links them; a forwarded card would link someone else.
    if (contact.user_id !== undefined && message.from && contact.user_id !== message.from.id) {
      await client.sendMessage(chatId, "Please share your own number using the button below.", SHARE_KEYBOARD);
      return;
    }
    const linked = family.linkTelegram(contact.phone_number, chatId);
    if (linked.length === 0) {
      await client.sendMessage(
        chatId,
        "No one has saved this number as family yet. Ask them to send CareGuard your number, then tap the button again.",
        REMOVE_KEYBOARD,
      );
      return;
    }
    const names = new Set(
      linked.map((member) => {
        try {
          return elders.get(member.elderId).name ?? "your family member";
        } catch {
          return "your family member";
        }
      }),
    );
    await client.sendMessage(
      chatId,
      `You're linked. CareGuard will alert you here if ${[...names].join(" or ")} receives a likely scam.`,
      REMOVE_KEYBOARD,
    );
  }

  async function toUserMessage(message: TelegramMessage): Promise<ChatCompletionUserMessageParam | null> {
    const parts: ChatCompletionContentPart[] = [];
    const text = (message.text ?? message.caption ?? "").trim();
    if (text) parts.push({ type: "text", text });
    const largest = message.photo?.at(-1); // Telegram lists photo sizes smallest first
    if (largest) {
      const file = await client.downloadFile(largest.file_id);
      if (file) parts.push({ type: "image_url", image_url: { url: `data:${file.contentType};base64,${file.bytes.toString("base64")}` } });
    }
    return parts.length > 0 ? { role: "user", content: parts } : null;
  }

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    if (message.contact) return linkFamily(chatId, message);

    const text = (message.text ?? "").trim();
    if (text === "/start" || text.startsWith("/start ")) {
      await client.sendMessage(chatId, WELCOME, SHARE_KEYBOARD);
      return;
    }

    await client.sendTyping(chatId);
    const userMessage = await toUserMessage(message);
    if (!userMessage) {
      await client.sendMessage(chatId, "Maaf, buat masa ini saya hanya boleh baca teks dan gambar.");
      return;
    }
    await pipeline.handle({
      phone: `${TELEGRAM_PREFIX}${chatId}`,
      name: message.from?.first_name ?? null,
      message: userMessage,
      externalId: `tg:${chatId}:${message.message_id}`,
      messenger,
    });
  }

  async function run(): Promise<void> {
    await client.deleteWebhook();
    while (running) {
      const started = Date.now();
      const updates = await client.getUpdates(offset, pollTimeoutSeconds, abort.signal);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message) continue;
        // Don't hold up polling on a model turn; the pipeline already serialises turns per chat.
        void handleMessage(update.message).catch((err: unknown) => {
          log.error("telegram message failed", { error: err instanceof Error ? err.message : String(err) });
        });
      }
      if (running && updates.length === 0 && Date.now() - started < 1_000) {
        await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loop = run().catch((err: unknown) => {
        log.error("telegram polling stopped", { error: err instanceof Error ? err.message : String(err) });
      });
    },
    async stop() {
      running = false;
      abort.abort();
      await loop;
    },
    handleMessage,
  };
}
