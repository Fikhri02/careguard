import type { FamilyMember } from "@careguard/shared";
import { describe, expect, it } from "vitest";
import { familyContext } from "./family-context.js";

const member = (overrides: Partial<FamilyMember>): FamilyMember => ({
  id: "fam_1",
  elderId: "eld_1",
  name: null,
  phone: "+60123456789",
  telegramChatId: null,
  createdAt: "2026-09-13T03:00:00.000Z",
  ...overrides,
});

describe("familyContext", () => {
  it("says when no family is saved", () => {
    expect(familyContext([])).toContain("no family member is saved");
  });

  it("names each saved person once, with how they are alerted", () => {
    const line = familyContext([
      member({ id: "fam_1", name: "Anak", phone: "+601123547858", telegramChatId: "555" }),
      member({ id: "fam_2", name: "Izadina irzati", phone: "telegram:555", telegramChatId: "555" }),
      member({ id: "fam_3", name: "Hafiz", phone: "+60198887777" }),
    ]);
    expect(line).toContain("Anak / Izadina irzati (alerted on Telegram); Hafiz (alerted by phone)");
    expect(line).toContain("Never ask for a family number that is already saved");
  });
});
