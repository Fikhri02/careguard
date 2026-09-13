import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import { ValidationError } from "../../errors.js";
import type { RemindersService } from "./service.js";

export function createReminderTools(reminders: RemindersService): ToolSet {
  return {
    create_reminder: defineTool({
      name: "create_reminder",
      description:
        "Create a simple reminder for the user, e.g. to pay a bill or attend an appointment. " +
        "Low-risk, so just do it and confirm warmly. Call this after explaining a bill or letter when the user agrees.",
      input: z.object({
        what: z.string().describe("What to remind them about, e.g. 'Pay TNB electricity bill RM143'"),
        dueText: z.string().describe("When, in the user's own words, e.g. 'before 25 September'"),
        dueAt: z
          .string()
          .optional()
          .describe("Exact reminder time as ISO-8601 with +08:00, e.g. 2026-09-24T09:00:00+08:00. Omit if unclear."),
      }),
      run: async (input, ctx) => {
        try {
          const reminder = reminders.create(ctx.elder, input);
          return reminder.dueAt
            ? `Reminder set for ${reminder.dueText}. I'll send a WhatsApp nudge then.`
            : `Reminder saved: "${reminder.what}" — ${reminder.dueText}.`;
        } catch (err) {
          if (err instanceof ValidationError) {
            return `Could not set that time: ${err.message} Retry with a valid dueAt, or omit it.`;
          }
          throw err;
        }
      },
    }),
  };
}
