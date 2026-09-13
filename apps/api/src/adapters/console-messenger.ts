import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";

/** Used when Twilio is not configured: logs what would have been sent. */
export function createConsoleMessenger(log: Logger): Messenger {
  return {
    async send({ to, body }) {
      log.info("outbound message (console messenger — Twilio not configured)", { to, body });
      return true;
    },
  };
}
