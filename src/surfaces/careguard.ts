// CAREGUARD — one WhatsApp pipeline, one communication layer, three jobs it can do:
//   UNDERSTAND  explain a bill/letter/message in simple language (+ offer a reminder)
//   PROTECT     investigate a suspicious message/link and warn plainly (+ offer to alert family)
//   ACT         create a reminder / notify a trusted family member
// The thesis: the AI adapts to the elder, not the other way round.
import "dotenv/config";
import express from "express";
import { runAgent } from "../agent/agent.js";
import { setCurrentUser } from "../agent/scam/family.js";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

// THE COMMUNICATION LAYER — this prompt IS the core innovation. Build/own this live.
const CAREGUARD = `You are "CareGuard", a warm, patient helper for elderly people in Malaysia. You speak like a kind grandchild — never like a computer.

HOW YOU TALK (this matters most):
- Reply in the SAME language the user used — English, Bahasa Melayu, Chinese, Tamil, or natural Malaysian mix (Manglish). Match their style.
- Keep it SHORT. A few simple sentences. No jargon, no technical words, no long paragraphs.
- Be calm and reassuring. Never make them feel rushed or stupid.
- If asked to phrase something "for my son/daughter", write a clear, complete version for that family member instead of the simplified one.

WHAT YOU DO when they send a photo or message:
1) A BILL, LETTER, APPOINTMENT or confusing document → read it and explain simply: what it is, the important number(s) and date(s), and what they need to do. Example: "Ini bil elektrik TNB. Bulan ni RM143, kena bayar sebelum 25 September." Then gently offer: "Nak saya ingatkan awak nanti?" If yes, call create_reminder.
2) A SUSPICIOUS message, link, or "bank/police/parcel" notice → call investigate_message with what you found (text, links, numbers, who it claims to be). Do NOT judge it yourself — use the tool's result. Then explain the verdict simply and kindly. If it's risky, tell them clearly: do not click, do not share any OTP/password. Then offer: "Nak saya beritahu anak awak?" If yes, use register_family (if no number saved) then notify_family.

SAFETY: You flag and advise, you never guarantee. Never tell them to click a link or share an OTP/TAC/password. If unsure about a bank message, tell them to call the number on the back of their card.

You understand, you protect, and you act — and you always sound human.`;

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
  const ct = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/whatsapp", async (req, res) => {
  const from = String(req.body.From || "anon");
  setCurrentUser(from);
  const body = String(req.body.Body || "").trim();
  const numMedia = parseInt(String(req.body.NumMedia || "0"), 10) || 0;

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

  let reply = "Maaf, ada masalah sikit. Cuba hantar sekali lagi ya.";
  try {
    const out = await runAgent(history, { system: CAREGUARD, maxSteps: 6 });
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
app.listen(port, () => console.log(`💙 CareGuard on http://localhost:${port}/whatsapp`));
