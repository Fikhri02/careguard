// Seed pricing for the demo (POC values — swap for live/scraped data before judging).
// Resale = indicative CompAsia-style buy price by cosmetic grade, 128GB baseline, in RM.
// Repair = indicative third-party repair menu, in RM.
// These exist so the demo NEVER depends on a live scrape. Wire one live Exa comp on top.

export type Grade = "A" | "B" | "C";
export type Model =
  | "iPhone 11" | "iPhone 12" | "iPhone 13" | "iPhone 14" | "iPhone 15";

export const RESALE: Record<Model, Record<Grade, number>> = {
  "iPhone 11": { A: 700, B: 550, C: 380 },
  "iPhone 12": { A: 950, B: 780, C: 560 },
  "iPhone 13": { A: 1300, B: 1080, C: 800 },
  "iPhone 14": { A: 1750, B: 1480, C: 1120 },
  "iPhone 15": { A: 2300, B: 1980, C: 1550 },
};

export const REPAIR: Record<Model, { screen: number; battery: number; backGlass: number }> = {
  "iPhone 11": { screen: 260, battery: 150, backGlass: 180 },
  "iPhone 12": { screen: 300, battery: 170, backGlass: 220 },
  "iPhone 13": { screen: 360, battery: 190, backGlass: 260 },
  "iPhone 14": { screen: 420, battery: 210, backGlass: 320 },
  "iPhone 15": { screen: 520, battery: 240, backGlass: 400 },
};

export const MODELS = Object.keys(RESALE) as Model[];

export function isKnownModel(m: string): m is Model {
  return (MODELS as string[]).includes(m);
}
