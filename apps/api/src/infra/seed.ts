import type { Services } from "../services.js";

export const DEMO_PHONE = "whatsapp:+60000000001";

/** Demo data for an empty database (SEED_DEMO=true). Returns false when anything already exists. */
export function seedDemo(services: Services): boolean {
  if (services.elders.list().length > 0) return false;

  const mak = services.elders.findOrCreateByPhone(DEMO_PHONE, "Mak");
  services.events.record({
    elderId: mak.id,
    type: "bill_explained",
    severity: "low",
    summary: "Explained a TNB electricity bill — RM143, due 25 Sep. Reminder set.",
    detail: { kind: "bill", amount: 143, due: "2026-09-25", example: true },
  });
  services.events.record({
    elderId: mak.id,
    type: "scam_detected",
    severity: "high",
    summary: "Likely scam — fake Maybank 'account suspended' message with a phishing link.",
    detail: {
      reasons: [
        "Asks for an OTP/TAC/password — real banks never do this",
        'Link maybank-verify.xyz: Mentions "maybank" but the link is maybank-verify.xyz, not an official maybank domain',
      ],
      example: true,
    },
  });
  return true;
}
