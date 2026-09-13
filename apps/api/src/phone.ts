/** Twilio addresses WhatsApp users as `whatsapp:+<E.164>`. Elders are keyed by that form. */
export function toWhatsApp(phone: string): string {
  return phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
}

/** Normalises Malaysian-style input (`012-345 6789`, `60123456789`, `whatsapp:+60…`) to `+60…`. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[^\d+]/g, "");
  const withPlus = compact.startsWith("+")
    ? compact
    : compact.startsWith("60")
      ? `+${compact}`
      : compact.startsWith("0")
        ? `+6${compact}`
        : `+${compact}`;
  return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
}
