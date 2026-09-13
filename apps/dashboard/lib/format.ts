import type { CareEvent, Elder, EventType } from "@careguard/shared";

export const EVENT_LABEL: Record<EventType, string> = {
  scam_detected: "Scam caught",
  high_risk_action: "Risky action",
  bill_explained: "Document explained",
  reminder_created: "Reminder set",
};

/** Events the family must decide on. Low-severity activity is only logged. */
export function needsAttention(event: CareEvent): boolean {
  return event.status === "new" && (event.type === "scam_detected" || event.type === "high_risk_action");
}

export function statusLabel(event: CareEvent): { text: string; tone: "new" | "approved" | "quiet" } {
  if (event.status === "approved") return { text: "Approved", tone: "approved" };
  if (event.status === "dismissed") return { text: "Dismissed", tone: "quiet" };
  if (event.status === "resolved") return { text: "Resolved", tone: "quiet" };
  return needsAttention(event) ? { text: "Needs you", tone: "new" } : { text: "Logged", tone: "quiet" };
}

export function elderLabel(elders: ReadonlyMap<string, Elder>, elderId: string): string {
  const elder = elders.get(elderId);
  if (!elder) return "Someone new";
  return elder.name ?? elder.phone.replace(/^whatsapp:/, "");
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export const reasonsOf = (event: CareEvent): string[] => stringList(event.detail.reasons);
export const urlsOf = (event: CareEvent): string[] => stringList(event.detail.urls);
export const isExample = (event: CareEvent): boolean => event.detail.example === true;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Only call on the client after mount; server and browser clocks and ICU data differ. */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}

/** Newest first, with `event` replacing any stale copy. */
export function upsertEvent(list: CareEvent[], event: CareEvent): CareEvent[] {
  return [event, ...list.filter((item) => item.id !== event.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
