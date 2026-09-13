import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import { toWhatsApp } from "../phone.js";

export interface TwilioMessengerOptions {
  accountSid: string;
  authToken: string;
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createTwilioMessenger(opts: TwilioMessengerOptions, log: Logger): Messenger {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64")}`;

  return {
    async send({ to, body }) {
      try {
        const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: toWhatsApp(opts.from), To: toWhatsApp(to), Body: body }).toString(),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          // Twilio's code and message say why (unjoined sandbox number, trial limits, ...); the status alone doesn't.
          const detail = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
          log.warn("twilio send failed", { status: res.status, to, code: detail?.code, reason: detail?.message });
          return false;
        }
        return true;
      } catch (err) {
        log.warn("twilio send error", { error: (err as Error).message, to });
        return false;
      }
    },
  };
}
