import { z } from "zod";
import type { Elder } from "./elder.js";
import { CareEvent, EventStatus, Severity } from "./event.js";
import type { Reminder } from "./reminder.js";

export const ListEventsQuery = z.object({
  elderId: z.string().optional(),
  status: EventStatus.optional(),
  severity: Severity.optional(),
  since: z.iso.datetime().optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuery>;

export const ListRemindersQuery = z.object({ elderId: z.string().optional() });
export type ListRemindersQuery = z.infer<typeof ListRemindersQuery>;

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiError>;

export const StreamMessage = z.object({
  type: z.enum(["event.created", "event.updated"]),
  event: CareEvent,
});
export type StreamMessage = z.infer<typeof StreamMessage>;

export const SimulateRequest = z.object({ phone: z.string().min(1), text: z.string().min(1) });
export type SimulateRequest = z.infer<typeof SimulateRequest>;

export const OutboundMessage = z.object({ to: z.string(), body: z.string() });
export type OutboundMessage = z.infer<typeof OutboundMessage>;

export type EventListResponse = { events: CareEvent[] };
export type ElderListResponse = { elders: Elder[] };
export type ReminderListResponse = { reminders: Reminder[] };
export type SimulateResponse = { reply: string | null; sent: OutboundMessage[]; events: CareEvent[] };
