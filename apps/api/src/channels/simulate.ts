import { SimulateRequest, type SimulateResponse } from "@careguard/shared";
import type { RequestHandler } from "express";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import type { InboundPipeline } from "../agent/pipeline.js";
import { normalizePhone, toWhatsApp } from "../phone.js";

/** Runs a full WhatsApp turn without Twilio. Every outbound message is captured and returned, never sent. */
export function createSimulateHandler(pipeline: Pick<InboundPipeline, "handle">): RequestHandler {
  return async (req, res) => {
    const { phone, text } = SimulateRequest.parse(req.body);
    const messenger = new CapturingMessenger();
    const result = await pipeline.handle({
      phone: toWhatsApp(normalizePhone(phone) ?? phone),
      message: { role: "user", content: [{ type: "text", text }] },
      messenger,
    });
    res.json({ reply: result.reply, sent: messenger.sent, events: result.events } satisfies SimulateResponse);
  };
}
