import type { TelegramClient } from "../channels/telegram/client.js";
import type { Messenger } from "../ports/messenger.js";

/** Telegram users are addressed as `telegram:<chat id>`, the same way WhatsApp users are `whatsapp:+60…`. */
export const TELEGRAM_PREFIX = "telegram:";

export function createTelegramMessenger(client: TelegramClient): Messenger {
  return {
    async send({ to, body }) {
      if (!to.startsWith(TELEGRAM_PREFIX)) return false;
      return client.sendMessage(to.slice(TELEGRAM_PREFIX.length), body);
    },
  };
}
