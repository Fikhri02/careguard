import { DocumentKind } from "@careguard/shared";
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import type { UnderstandService } from "./service.js";

export function createUnderstandTools(understand: UnderstandService): ToolSet {
  return {
    log_document: defineTool({
      name: "log_document",
      description:
        "Record that you explained a bill, letter or appointment to the user, so their family sees it on their timeline. " +
        "Call once after explaining a document.",
      input: z.object({
        kind: DocumentKind.describe("What kind of document it was"),
        summary: z.string().describe("One line, e.g. 'TNB electricity bill — RM143, due 25 Sep'"),
      }),
      run: async (input, ctx) => {
        understand.logDocument(ctx.elder, input);
        return "Logged for the family timeline.";
      },
    }),
  };
}
