// THE DECISION ENGINE — the product.
// Rippletide won the OpenAI Codex hackathon on exactly this idea: the value isn't
// the raw numbers, it's the *verdict*. This turns an assessment into a recommendation.

import { RESALE, REPAIR, isKnownModel, type Grade, type Model } from "./prices.js";

export type Issue = "cracked_screen" | "cracked_back" | "weak_battery";

export interface Assessment {
  model: string;        // e.g. "iPhone 13"
  grade: Grade;         // current cosmetic grade
  batteryPct?: number;  // from the Battery Health screenshot
  issues: Issue[];
  purchaseDate?: string; // ISO, if user gave it — for warranty
}

export interface Verdict {
  ok: boolean;
  model: string;
  grade: Grade;
  resaleNow: number;
  repairCost: number;
  resaleAfterRepair: number;
  uplift: number;                // resaleAfterRepair - resaleNow - repairCost
  inWarranty: boolean;
  headline: "REPAIR, THEN SELL" | "SELL AS-IS" | "KEEP USING IT" | "REPAIR & KEEP";
  reasons: string[];
  note?: string;
}

const UPLIFT_THRESHOLD = 50; // RM — below this, repairing-to-sell isn't worth the hassle

export function decide(a: Assessment): Verdict {
  if (!isKnownModel(a.model)) {
    return {
      ok: false, model: a.model, grade: a.grade, resaleNow: 0, repairCost: 0,
      resaleAfterRepair: 0, uplift: 0, inWarranty: false, headline: "KEEP USING IT",
      reasons: [`I don't have pricing for "${a.model}" yet.`],
    };
  }
  const model = a.model as Model;
  const issues = a.issues ?? [];
  const batteryWeak = (a.batteryPct ?? 100) < 80 || issues.includes("weak_battery");

  // Repair cost = sum of the fixes this phone actually needs.
  const menu = REPAIR[model];
  let repairCost = 0;
  if (issues.includes("cracked_screen")) repairCost += menu.screen;
  if (issues.includes("cracked_back")) repairCost += menu.backGlass;
  if (batteryWeak) repairCost += menu.battery;

  // Grade after a proper repair: back-glass or multiple issues -> B; otherwise A.
  const afterGrade: Grade = issues.includes("cracked_back") || issues.length > 1 ? "B" : "A";

  const resaleNow = RESALE[model][a.grade];
  const resaleAfterRepair = RESALE[model][afterGrade];
  const uplift = resaleAfterRepair - resaleNow - repairCost;

  const inWarranty = withinWarranty(a.purchaseDate);
  const reasons: string[] = [];
  let headline: Verdict["headline"];

  if (repairCost === 0) {
    headline = "KEEP USING IT";
    reasons.push("No repairs needed — it's in good shape.");
    reasons.push(`If you'd rather cash out, resale is about RM${resaleNow}.`);
  } else if (repairCost > resaleNow) {
    headline = "SELL AS-IS";
    reasons.push(`Repair (RM${repairCost}) costs more than the phone's current resale (RM${resaleNow}).`);
    reasons.push("Sell it as-is or keep using it — fixing it to sell loses money.");
  } else if (uplift >= UPLIFT_THRESHOLD) {
    headline = "REPAIR, THEN SELL";
    reasons.push(`Spend RM${repairCost} on repairs → resale rises from RM${resaleNow} to RM${resaleAfterRepair}.`);
    reasons.push(`Net gain after repair: about RM${uplift}. Worth doing.`);
  } else {
    headline = "REPAIR & KEEP";
    const grossGain = resaleAfterRepair - resaleNow;
    reasons.push(`Repairing raises resale by ~RM${grossGain}, but after the RM${repairCost} cost the net is only ~RM${uplift} — not worth flipping for profit.`);
    reasons.push("If you like the phone, repair it and keep using it; otherwise sell as-is.");
  }

  let note: string | undefined;
  if (inWarranty) {
    note =
      "📋 Still within Apple's 1-year warranty. That covers defects, NOT accidental damage — " +
      "but if you have AppleCare+, screen repair is a low fixed fee, which usually flips the maths toward repairing.";
  }

  return {
    ok: true, model, grade: a.grade, resaleNow, repairCost, resaleAfterRepair,
    uplift, inWarranty, headline, reasons, note,
  };
}

function withinWarranty(purchaseDate?: string): boolean {
  if (!purchaseDate) return false;
  const d = new Date(purchaseDate);
  if (isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days >= 0 && days <= 365;
}

/** Render the verdict as a tight WhatsApp-friendly message. */
export function renderVerdict(v: Verdict, liveComp?: string): string {
  if (!v.ok) return v.reasons.join(" ");
  const lines = [
    `*${v.headline}*  —  ${v.model} (Grade ${v.grade})`,
    "",
    ...v.reasons.map((r) => `• ${r}`),
    "",
    `Sell now: ~RM${v.resaleNow}   |   Repair: ~RM${v.repairCost}   |   After repair: ~RM${v.resaleAfterRepair}`,
  ];
  if (v.note) lines.push("", v.note);
  if (liveComp) lines.push("", `_Live check:_ ${liveComp}`);
  return lines.join("\n");
}
