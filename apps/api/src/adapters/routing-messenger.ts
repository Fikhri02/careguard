import type { Messenger } from "../ports/messenger.js";
import { TELEGRAM_PREFIX } from "./telegram-messenger.js";

/** Sends `telegram:` addresses through Telegram and everything else through the fallback (Twilio or console). */
export function createRoutingMessenger(routes: { telegram?: Messenger; fallback: Messenger }): Messenger {
  return {
    send: (message) =>
      message.to.startsWith(TELEGRAM_PREFIX) && routes.telegram ? routes.telegram.send(message) : routes.fallback.send(message),
  };
}
