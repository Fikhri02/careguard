import type { RequestHandler } from "express";
import type { MediaFetcher } from "../../adapters/twilio-media.js";
import type { InboundPipeline } from "../../agent/pipeline.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import { parseTwilioForm, toUserMessage } from "./inbound.js";
import { isValidTwilioSignature } from "./signature.js";

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface WhatsAppWebhookDeps {
  pipeline: Pick<InboundPipeline, "handle">;
  messenger: Messenger;
  fetchMedia: MediaFetcher;
  log: Logger;
  /** Omitted when TWILIO_AUTH_TOKEN or PUBLIC_URL is unset (never in production). */
  signature?: { authToken: string; publicUrl: string };
}

export function createWhatsAppWebhook({ pipeline, messenger, fetchMedia, log, signature }: WhatsAppWebhookDeps): RequestHandler {
  return (req, res) => {
    const form = (req.body ?? {}) as Record<string, string>;

    if (signature) {
      const url = new URL(req.originalUrl, signature.publicUrl).toString();
      if (!isValidTwilioSignature(signature.authToken, url, form, req.get("X-Twilio-Signature"))) {
        log.warn("rejected webhook with an invalid Twilio signature", { url });
        res.status(403).type("text/plain").send("Invalid signature");
        return;
      }
    }

    const inbound = parseTwilioForm(form);
    if (!inbound.from) {
      res.status(400).type("text/plain").send("Missing From");
      return;
    }

    // Acknowledge first: the agent can take longer than Twilio's ~15 s timeout.
    res.type("text/xml").send(EMPTY_TWIML);

    void (async () => {
      const message = await toUserMessage(inbound, fetchMedia);
      await pipeline.handle({ phone: inbound.from, message, externalId: inbound.messageSid, messenger });
    })().catch((err: unknown) => {
      log.error("webhook turn failed", { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
