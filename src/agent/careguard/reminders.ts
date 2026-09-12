// "Act" — the low-risk action tier. Creating a reminder is auto (no confirmation).
// In-memory for the hackathon; in production this is a Trigger.dev scheduled job.

import type { Tool } from "../tools.js";
import { currentUser } from "../scam/family.js"; // shared per-user context
import { addEvent } from "../events.js";

export interface Reminder { what: string; when: string; }
export const remindersOf = new Map<string, Reminder[]>();

export const reminderTools: Record<string, Tool> = {
  create_reminder: {
    schema: {
      type: "function",
      function: {
        name: "create_reminder",
        description:
          "Create a simple reminder for the user (e.g. to pay a bill or attend an appointment). " +
          "Low-risk, so just do it and confirm warmly. Call this after explaining a bill/letter when the user agrees.",
        parameters: {
          type: "object",
          properties: {
            what: { type: "string", description: "What to remind them about, e.g. 'Pay TNB electricity bill RM143'" },
            when: { type: "string", description: "When, in the user's words, e.g. 'before 25 September'" },
          },
          required: ["what", "when"],
        },
      },
    },
    run: async ({ what, when }) => {
      const list = remindersOf.get(currentUser) ?? [];
      list.push({ what: String(what), when: String(when) });
      remindersOf.set(currentUser, list);
      // Log a low-severity event so the family timeline shows it (no interruption).
      addEvent({ elderId: currentUser, type: "reminder_created", severity: "low",
        summary: `Reminder set: ${what} — ${when}` });
      return `Reminder set: "${what}" — ${when}. I'll nudge you. (You now have ${list.length} reminder(s).)`;
    },
  },
};
