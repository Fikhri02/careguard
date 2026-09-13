import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import { ValidationError } from "../../errors.js";
import type { FamilyService } from "./service.js";

export function createFamilyTools(family: FamilyService): ToolSet {
  return {
    register_family: defineTool({
      name: "register_family",
      description:
        "Save a trusted family member's phone number so CareGuard can alert them about scams. " +
        "Call this when the user shares a number, e.g. 'my daughter's number is 012-3456789'.",
      input: z.object({
        phone: z.string().describe("The family member's phone number, e.g. 012-3456789 or +60123456789"),
        name: z.string().optional().describe("Name or relationship, e.g. 'Aisyah (daughter)'"),
      }),
      run: async ({ phone, name }, ctx) => {
        try {
          const member = family.register(ctx.elder.id, { phone, name });
          return `Saved ${member.name ?? member.phone}. I'll alert ${member.phone} if something risky happens.`;
        } catch (err) {
          if (err instanceof ValidationError) return `${err.message} Ask the user for a number like 012-3456789.`;
          throw err;
        }
      },
    }),

    notify_family: defineTool({
      name: "notify_family",
      description:
        "Alert the user's registered family members. investigate_message already alerts them by itself on a HIGH-risk verdict, " +
        "so call this only when the user asks you to tell their family, or with alreadyShared true when the user already " +
        "clicked a link, paid, or shared a password, PIN, OTP or TAC.",
      input: z.object({
        summary: z.string().describe("One line on what the scam was, e.g. 'fake Maybank account-blocked SMS'"),
        alreadyShared: z
          .boolean()
          .optional()
          .describe("True when the user already clicked, paid or shared details — sends an urgent call-now alert"),
      }),
      run: async ({ summary, alreadyShared = false }, ctx) => {
        if (!alreadyShared && family.alertedRecently(ctx.elder.id)) {
          return "Their family was already alerted about this a few minutes ago, so no second alert was sent. Tell the user their family already knows.";
        }
        const { delivered, total } = await family.notify(ctx.elder, summary, ctx.messenger, { urgent: alreadyShared });
        if (total === 0) return "No family number saved yet — ask the user for one, then call register_family.";
        if (delivered === 0) {
          return "The alert could not be delivered right now. Tell the user honestly and suggest they call their family directly.";
        }
        return `Alerted ${delivered} of ${total} family member(s).`;
      },
    }),
  };
}
