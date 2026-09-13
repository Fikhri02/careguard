import { z } from "zod";

export const ReminderStatus = z.enum(["scheduled", "sent", "cancelled"]);
export type ReminderStatus = z.infer<typeof ReminderStatus>;

export const Reminder = z.object({
  id: z.string(),
  elderId: z.string(),
  what: z.string(),
  dueText: z.string(),
  dueAt: z.string().nullable(),
  status: ReminderStatus,
  createdAt: z.string(),
});
export type Reminder = z.infer<typeof Reminder>;
