// Surface for IDEA A: "Repair or Sell?" iPhone agent, living in WhatsApp.
// Twilio WhatsApp sandbox -> this webhook. Images are downloaded (Twilio needs auth),
// passed to the vision model as base64, and the agent calls quote_iphone.
//
// Setup (do tonight):
//   1. Twilio console -> Messaging -> Try it out -> WhatsApp sandbox. Join with the code.
//   2. Expose this server:  npx ngrok http 8788   (or deploy to Cloud Run)
//   3. Set the sandbox "When a message comes in" webhook to  https://<host>/whatsapp
//   4. .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_API_KEY, EXA_API_KEY
import "dotenv/config";
import express from "express";
import { runAgent } from "../agent/agent.js";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

const IPHONE_SYSTEM = `You are "TradeMate", a WhatsApp agent that tells Malaysians whether to REPAIR or SELL their iPhone. Currency is RM.

How you work:
- When the user sends a PHOTO of a phone: assess cosmetic condition and assign a grade — A (mint), B (minor wear), C (cracked / heavy wear) — and note visible damage (cracked_screen, cracked_back).
- When they send a SCREENSHOT of Settings > Battery Health or About: read the model, storage, and battery maximum capacity %.
- The moment you know the model + grade (battery % if you can get it), CALL quote_iphone. If you don't have a battery screenshot yet, ask for one in ONE short line first — don't stall forever.
- Lead your reply with the verdict, then the numbers. Keep it WhatsApp-short: a few lines, no essays. You may use *bold* and bullet dots.
- Never invent prices; the quote_iphone tool provides them.`;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const threads = new Map<string, ChatCompletionMessageParam[]>();

async function twilioMediaToDataUrl(url: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const res = await fetch(url, {
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/whatsapp", async (req, res) => {
  const from = String(req.body.From || "anon");
  const body = String(req.body.Body || "").trim();
  const numMedia = parseInt(String(req.body.NumMedia || "0"), 10) || 0;

  // Build this turn's user message: text + any images (as vision parts).
  const parts: ChatCompletionContentPart[] = [];
  if (body) parts.push({ type: "text", text: body });
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = req.body[`MediaUrl${i}`];
    const ctype = String(req.body[`MediaContentType${i}`] || "");
    if (mediaUrl && ctype.startsWith("image/")) {
      const dataUrl = await twilioMediaToDataUrl(String(mediaUrl));
      if (dataUrl) parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }
  if (parts.length === 0) parts.push({ type: "text", text: "(no content)" });

  const history = threads.get(from) ?? [];
  history.push({ role: "user", content: parts });

  let reply = "Sorry, something went wrong — try sending the photo again.";
  try {
    const out = await runAgent(history, { system: IPHONE_SYSTEM, maxSteps: 5 });
    reply = out.reply || reply;
    threads.set(from, out.history);
  } catch (err) {
    console.error(err);
  }

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
});

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

const port = Number(process.env.PORT) || 8788;
app.listen(port, () => console.log(`WhatsApp agent (TradeMate) on http://localhost:${port}/whatsapp`));
