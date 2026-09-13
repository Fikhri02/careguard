import { z } from "zod";

export const EventType = z.enum(["bill_explained", "scam_detected", "high_risk_action", "reminder_created"]);
export type EventType = z.infer<typeof EventType>;

export const Severity = z.enum(["low", "med", "high"]);
export type Severity = z.infer<typeof Severity>;

export const EventStatus = z.enum(["new", "approved", "dismissed", "resolved"]);
export type EventStatus = z.infer<typeof EventStatus>;

export const DocumentKind = z.enum(["bill", "letter", "appointment", "other"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const CareEvent = z.object({
  id: z.string(),
  elderId: z.string(),
  type: EventType,
  severity: Severity,
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
  status: EventStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type CareEvent = z.infer<typeof CareEvent>;
