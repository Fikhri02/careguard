import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import type { EventsService } from "../events/service.js";
import type { ProtectService } from "./service.js";
import { renderVerdict } from "./verdict.js";

export function createProtectTools(protect: ProtectService, events: EventsService): ToolSet {
  return {
    investigate_message: defineTool({
      name: "investigate_message",
      description:
        "Investigate a suspicious message the user forwarded (as text or a screenshot). Pass the message text and " +
        "anything you extracted from it. Returns a risk verdict with reasons. Always call this before advising the user.",
      input: z.object({
        text: z.string().describe("The full text of the suspicious message"),
        urls: z.array(z.string()).optional().describe("Links found in the message"),
        phones: z.array(z.string()).optional().describe("Phone or bank-account numbers found in the message"),
        senderClaim: z.string().optional().describe("Who the sender claims to be, e.g. 'Maybank', 'PDRM'"),
      }),
      run: async (input, ctx) => {
        const result = await protect.investigate(input);
        if (result.risk === "HIGH") {
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
        }
        return renderVerdict(result);
      },
    }),
  };
}
