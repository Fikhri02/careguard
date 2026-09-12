// SCAM GUARDIAN — a WhatsApp agent that protects elderly Malaysians from scams.
// Forward a suspicious message (text OR screenshot) -> it investigates -> plain-language
// verdict -> offers to alert the family. Reuses the same Twilio webhook pattern.
//
// Setup: join the Twilio WhatsApp sandbox, `npm run scam`, ngrok, point the sandbox
// "when a message comes in" webhook at https://<host>/whatsapp. See .env.example.
import "dotenv/config";
import express from "express";
import { runAgent } from "../agent/agent.js";
import { setCurrentUser } from "../agent/scam/family.js";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

const SYSTEM = `You are "Scam Guardian", a calm, kind WhatsApp helper that protects people (especially elderly Malaysians) from scams. You may receive messages in English, Malay, Chinese or Tamil — reply in the same language, simply and warmly, like talking to a worried parent.

When the user forwards a suspicious message (as text OR a screenshot you can read):
1. Read it. Pull out the message text, any links (URLs), and any phone or bank-account numbers, and who it claims to be from.
2. Call investigate_message with what you found. Do NOT guess a verdict yourself — use the tool's result.
3. Relay the verdict in a few short, reassuring lines. Lead with whether it's safe or a scam, then the top reasons, then clear advice. Never tell them to click a link or share an OTP/password.
4. If it's risky, gently offer: "Would you like me to alert your family?" If they say yes and you have no family number saved, ask for it and call register_family, then call notify_family.

Keep replies short and WhatsApp-friendly. Be warm, never alarmist. You protect and reassure.`;

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
  setCurrentUser(from); // so family tools know whose family to alert
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

  let reply = "Sorry, I had trouble checking that. Please send it again.";
  try {
    const out = await runAgent(history, { system: SYSTEM, maxSteps: 6 });
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
app.listen(port, () => console.log(`🛡️  Scam Guardian on http://localhost:${port}/whatsapp`));
