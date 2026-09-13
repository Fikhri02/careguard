import type { Elder } from "@careguard/shared";
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import type { Messenger } from "../../ports/messenger.js";
import type { EventsService } from "../events/service.js";
import type { FamilyService } from "../family/service.js";
import type { ProtectService } from "./service.js";
import { renderVerdict } from "./verdict.js";

export function createProtectTools(protect: ProtectService, events: EventsService, family: FamilyService): ToolSet {
  return {
    investigate_message: defineTool({
      name: "investigate_message",
      description:
        "Investigate a suspicious message the user forwarded (as text or a screenshot). Pass the message text and " +
        "anything you extracted from it. Returns a risk verdict with reasons, and alerts the saved family on HIGH risk. " +
        "Always call this before advising the user.",
      input: z.object({
        text: z.string().describe("The full text of the suspicious message"),
        urls: z.array(z.string()).optional().describe("Links found in the message"),
        phones: z.array(z.string()).optional().describe("Phone or bank-account numbers found in the message"),
        senderClaim: z.string().optional().describe("Who the sender claims to be, e.g. 'Maybank', 'PDRM'"),
      }),
      run: async (input, ctx) => {
        const result = await protect.investigate(input);
        const verdict = renderVerdict(result);
        if (result.risk !== "HIGH") return verdict;

        events.record({
          elderId: ctx.elder.id,
          type: "scam_detected",
          severity: "high",
          summary: result.reasons[0] ? `Likely scam — ${result.reasons[0]}` : "Likely scam message",
          detail: {
            reasons: result.reasons.slice(0, 5),
            urls: input.urls ?? [],
            senderClaim: input.senderClaim ?? null,
            webNote: result.webNote,
          },
        });
        const summary = input.senderClaim ? `a message pretending to be ${input.senderClaim}` : "a suspicious message";
        return `${verdict}\n\n${await alertFamily(family, ctx.elder, summary, ctx.messenger)}`;
      },
    }),
  };
}

/**
 * HIGH risk alerts the family straight away, without asking the elder: consent was given when they saved the
 * number, and an embarrassed elder is the one most likely to say "don't tell my son". The elder is always told.
 */
async function alertFamily(family: FamilyService, elder: Elder, summary: string, messenger: Messenger): Promise<string> {
  if (family.list(elder.id).length === 0) {
    return "Family: no family number is saved yet. After your advice, offer to save a son's or daughter's number so CareGuard can alert them next time.";
  }
  if (family.alertedRecently(elder.id)) {
    return "Family: already alerted about this a few minutes ago. Tell the user their family already knows. Do not call notify_family.";
  }
  const { delivered, total } = await family.notify(elder, summary, messenger);
  if (delivered === 0) {
    return "Family: the alert could not be delivered. Tell the user honestly and suggest they call their family directly.";
  }
  return (
    `Family: CareGuard has ALREADY alerted the user's family (${delivered} of ${total}). ` +
    'Tell the user in one short sentence that their family has been told, e.g. "Saya dah beritahu anak awak." ' +
    "Do not ask whether to tell them, and do not call notify_family."
  );
}
