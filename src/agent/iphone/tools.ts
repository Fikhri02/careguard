// iPhone quote tools — plugged into the main agent registry.
// The model does the *seeing* (vision reads the photo + Battery Health screenshot),
// then calls quote_iphone with what it found. This tool does the *deciding*.

import type { Tool } from "../tools.js";
import { decide, renderVerdict, type Assessment, type Issue } from "./decision.js";
import { exaSearch } from "../exa.js";

const ISSUES: Issue[] = ["cracked_screen", "cracked_back", "weak_battery"];

export const iphoneTools: Record<string, Tool> = {
  quote_iphone: {
    schema: {
      type: "function",
      function: {
        name: "quote_iphone",
        description:
          "Given an assessment of an iPhone (from the user's photo + Battery Health screenshot), " +
          "return the repair-or-sell recommendation with resale value, repair cost, and the verdict. " +
          "Call this once you know the model, cosmetic grade, and (ideally) battery %.",
        parameters: {
          type: "object",
          properties: {
            model: { type: "string", description: 'e.g. "iPhone 13"' },
            grade: { type: "string", enum: ["A", "B", "C"], description: "Current cosmetic grade: A=mint, B=minor wear, C=cracked/heavy wear" },
            batteryPct: { type: "number", description: "Battery maximum capacity % from the Battery Health screen, if known" },
            issues: {
              type: "array",
              items: { type: "string", enum: ISSUES },
              description: "Visible/known problems",
            },
            purchaseDate: { type: "string", description: "ISO date of purchase, if the user told you (for warranty)" },
          },
          required: ["model", "grade"],
        },
      },
    },
    run: async (args) => {
      const assessment: Assessment = {
        model: String(args.model),
        grade: (args.grade ?? "B") as Assessment["grade"],
        batteryPct: typeof args.batteryPct === "number" ? args.batteryPct : undefined,
        issues: Array.isArray(args.issues) ? (args.issues as Issue[]) : [],
        purchaseDate: args.purchaseDate,
      };
      const verdict = decide(assessment);

      // Live comp via Exa — one real, cited data point on top of the seed table.
      let liveComp: string | undefined;
      try {
        const results = await exaSearch(
          `CompAsia ${assessment.model} price Malaysia second hand`,
          2,
        );
        if (results[0]) liveComp = `${results[0].title} — ${results[0].url}`;
      } catch {
        /* seed pricing still stands if Exa is unavailable */
      }

      return renderVerdict(verdict, liveComp);
    },
  },
};
