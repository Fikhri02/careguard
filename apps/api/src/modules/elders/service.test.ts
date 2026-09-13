import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock } from "../../test/fakes.js";
import { createEldersRepo } from "./repo.js";
import { createEldersService } from "./service.js";

function setup() {
  const clock = fixedClock();
  return { clock, elders: createEldersService({ repo: createEldersRepo(createTestDb()), clock }) };
}

describe("EldersService", () => {
  it("creates an elder on first contact and reuses it afterwards", () => {
    const { elders } = setup();
    const first = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
    const again = elders.findOrCreateByPhone("whatsapp:+60123456789");

    expect(first).toMatchObject({ phone: "whatsapp:+60123456789", name: "Mak", language: null, createdAt: "2026-09-13T03:00:00.000Z" });
    expect(first.id).toMatch(/^eld_/);
    expect(again).toEqual(first);
    expect(elders.list()).toHaveLength(1);
  });

  it("lists elders oldest first", () => {
    const { elders, clock } = setup();
    elders.findOrCreateByPhone("whatsapp:+60111111111", "Mak");
    clock.set("2026-09-13T04:00:00.000Z");
    elders.findOrCreateByPhone("whatsapp:+60122222222", "Tok");
    expect(elders.list().map((e) => e.name)).toEqual(["Mak", "Tok"]);
  });

  it("throws NotFoundError for an unknown id", () => {
    const { elders } = setup();
    expect(() => elders.get("eld_missing")).toThrow(NotFoundError);
  });
});
