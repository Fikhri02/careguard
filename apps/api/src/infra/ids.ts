import { randomUUID } from "node:crypto";

export function newId(prefix: "eld" | "fam" | "evt" | "rem"): string {
  return `${prefix}_${randomUUID()}`;
}
