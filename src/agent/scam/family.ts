// "Notify Family" — the differentiator. Scam Guardian is a *guardian*, not just a
// checker: it loops in a trusted family member. Two tools: register + notify.
//
// Demo note: with the Twilio WhatsApp sandbox, the family member must also have
// joined the sandbox (send the join code once). Set TWILIO_WHATSAPP_FROM in .env.

import type { Tool } from "../tools.js";

// In-memory for the hackathon. Swap for a DB / the elder's saved contact later.
// Keyed by the elder's WhatsApp id -> family WhatsApp number.
export const familyOf = new Map<string, string>();

// The surface sets this per turn so the tools know who is asking.
export let currentUser = "demo";
export function setCurrentUser(id: string) { currentUser = id; }

export const familyTools: Record<string, Tool> = {
  register_family: {
    schema: {
      type: "function",
      function: {
        name: "register_family",
        description:
          "Save a family member's phone number so Scam Guardian can alert them about scams. " +
          "Call this when the user says something like 'my daughter's number is +60...'.",
        parameters: {
          type: "object",
          properties: { number: { type: "string", description: "Family member's phone in +60... format" } },
          required: ["number"],
        },
      },
    },
    run: async (args) => {
      const num = normalize(String(args.number || ""));
      if (!num) return "That doesn't look like a valid phone number — try the +60… format.";
      familyOf.set(currentUser, num);
      return `Saved. I'll alert ${num} if I spot a scam aimed at you.`;
    },
  },

  notify_family: {
    schema: {
      type: "function",
      function: {
        name: "notify_family",
        description:
          "Alert the registered family member that the user received a likely scam. " +
          "Call this after a HIGH-risk verdict, once the user agrees to notify their family.",
        parameters: {
          type: "object",
          properties: { summary: { type: "string", description: "One line on what the scam was" } },
          required: ["summary"],
        },
      },
    },
    run: async (args) => {
      const family = familyOf.get(currentUser);
      if (!family) return "No family number saved yet — ask the user for one, then call register_family.";
      const msg =
        `⚠️ Scam Guardian alert: your family member just received a likely scam ` +
        `(${String(args.summary || "suspicious message")}). ` +
        `I've advised them not to click anything or share any details. Might be worth a quick call to check in.`;
      const sent = await sendWhatsApp(family, msg);
      return sent
        ? `Done — I've alerted your family (${family}) and told them you're safe and didn't respond.`
        : `I couldn't send the alert automatically (Twilio not configured), but here's what your family should know: ${msg}`;
    },
  },
};

function normalize(n: string): string {
  const cleaned = n.replace(/[^\d+]/g, "");
  return /^\+?\d{8,15}$/.test(cleaned) ? cleaned : "";
}

async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886 (sandbox)
  if (!sid || !token || !from) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
        Body: body,
      }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
