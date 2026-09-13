import type { Investigation } from "./service.js";

// Plain headings: with an emoji heading the model copied "🔴 LIKELY A SCAM" into replies instead of writing its own warning line.
const HEADS = {
  HIGH: "VERDICT: HIGH RISK — likely a scam",
  MEDIUM: "VERDICT: MEDIUM RISK — possibly a scam",
  LOW: "VERDICT: LOW RISK — probably OK, but stay alert",
} as const;

/** The tool result the model reads. The model rephrases it in the elder's language. */
export function renderVerdict({ risk, reasons, webNote }: Investigation): string {
  const lines: string[] = [HEADS[risk]];
  if (reasons.length > 0) lines.push("", "Why:", ...reasons.slice(0, 5).map((reason) => `• ${reason}`));
  lines.push(
    "",
    risk === "LOW"
      ? "Nothing obviously dangerous — but never share OTP/passwords, and if unsure, call the company on the number printed on your card."
      : "Do NOT click any link or share any OTP, password or bank details. If it claims to be your bank, call the number on the back of your card — not any number in this message.",
  );
  if (webNote) lines.push("", `Web check: ${webNote}`);
  return lines.join("\n");
}
