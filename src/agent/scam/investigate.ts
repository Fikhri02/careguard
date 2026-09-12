// The investigation engine + tools for Scam Guardian.
// The agent (vision) reads the forwarded message/screenshot, extracts the text,
// any URLs and phone/account numbers, then calls investigate_message.
// This tool gathers the hard signals and returns a structured verdict.

import type { Tool } from "../tools.js";
import { checkUrl, type UrlFinding } from "./urlcheck.js";
import { exaSearch } from "../exa.js";
import { addEvent } from "../events.js";
import { currentUser } from "./family.js";

// Scam-pattern language (English + common Malay). Presence != guilt, but stacks the risk.
const PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\b(otp|tac|password|kata laluan|pin)\b/i, why: "Asks for an OTP/TAC/password — real banks never do this" },
  { re: /\b(block|blocked|suspend|disekat|digantung|dibekukan)\b/i, why: "Threatens to block/suspend your account (fake urgency)" },
  { re: /\b(verify|verification|sahkan|pengesahan|update|kemaskini)\b/i, why: "Demands you 'verify' or 'update' details via a link" },
  { re: /\b(urgent|segera|immediately|sekarang juga|dalam \d+ jam)\b/i, why: "Creates urgency to stop you thinking" },
  { re: /\b(parcel|bungkusan|pos|courier|customs|kastam|delivery)\b/i, why: "Parcel/delivery pretext (common Malaysian scam)" },
  { re: /\b(police|polis|pdrm|bank negara|bnm|lhdn|court|mahkamah)\b/i, why: "Impersonates police / a bank / an agency" },
  { re: /\b(prize|menang|hadiah|reward|won|winner|lucky draw)\b/i, why: "Promises a prize/winnings you didn't enter for" },
  { re: /\b(click|klik|tekan link|tap here|log ?masuk di)\b/i, why: "Pushes you to click a link and log in" },
];

type Risk = "HIGH" | "MEDIUM" | "LOW";

export const scamTools: Record<string, Tool> = {
  investigate_message: {
    schema: {
      type: "function",
      function: {
        name: "investigate_message",
        description:
          "Investigate a suspicious message the user forwarded. Pass the message text and anything you " +
          "extracted from it. Returns a structured risk verdict with reasons. Call this before advising the user.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "The full text of the suspicious message" },
            urls: { type: "array", items: { type: "string" }, description: "Any links found in the message" },
            phones: { type: "array", items: { type: "string" }, description: "Any phone or bank-account numbers found" },
            senderClaim: { type: "string", description: "Who the sender claims to be, e.g. 'Maybank', 'PDRM'" },
          },
          required: ["text"],
        },
      },
    },
    run: async (args) => {
      const text = String(args.text || "");
      const urls: string[] = Array.isArray(args.urls) ? args.urls.map(String) : [];
      const phones: string[] = Array.isArray(args.phones) ? args.phones.map(String) : [];

      const reasons: string[] = [];

      // 1) Language patterns
      for (const p of PATTERNS) if (p.re.test(text)) reasons.push(p.why);

      // 2) URL analysis
      const urlFindings: UrlFinding[] = [];
      for (const u of urls) {
        const f = await checkUrl(u, text);
        urlFindings.push(f);
        for (const flag of f.flags) reasons.push(`Link ${f.host}: ${flag}`);
      }

      // 3) Web search corroboration (Exa) — has anyone reported this number/sender?
      let webNote = "";
      try {
        const q = phones[0] || urls[0] || (args.senderClaim ? `${args.senderClaim} scam Malaysia` : text.slice(0, 60));
        const results = await exaSearch(`${q} scam report Malaysia`, 2);
        if (results[0]) webNote = `${results[0].title} — ${results[0].url}`;
      } catch {
        /* fine without it */
      }

      // Score
      const hasBadUrl = urlFindings.some((f) => f.suspicious);
      const patternHits = reasons.length - urlFindings.reduce((n, f) => n + f.flags.length, 0);
      let risk: Risk = "LOW";
      if (hasBadUrl || patternHits >= 2) risk = "HIGH";
      else if (patternHits === 1) risk = "MEDIUM";

      // High-risk scams become a HIGH event for the family dashboard to act on.
      if (risk === "HIGH") {
        addEvent({
          elderId: currentUser, type: "scam_detected", severity: "high",
          summary: reasons[0] ? `Blocked a likely scam — ${reasons[0]}` : "Blocked a likely scam message",
          detail: { reasons: reasons.slice(0, 5) },
        });
      }
      return render(risk, reasons, webNote);
    },
  },
};

function render(risk: Risk, reasons: string[], webNote: string): string {
  const emoji = risk === "HIGH" ? "🔴" : risk === "MEDIUM" ? "🟠" : "🟢";
  const head =
    risk === "HIGH" ? "LIKELY A SCAM" : risk === "MEDIUM" ? "BE CAREFUL — POSSIBLE SCAM" : "PROBABLY OK, BUT STAY ALERT";
  const lines = [`${emoji} ${head}`];
  if (reasons.length) {
    lines.push("", "Why:");
    lines.push(...reasons.slice(0, 5).map((r) => `• ${r}`));
  }
  lines.push(
    "",
    risk === "LOW"
      ? "Nothing obviously dangerous — but never share OTP/passwords, and if unsure, call the company on the number printed on your card."
      : "Do NOT click any link or share any OTP, password or bank details. If it claims to be your bank, call the number on the back of your card — not any number in this message.",
  );
  if (webNote) lines.push("", `Web check: ${webNote}`);
  return lines.join("\n");
}
