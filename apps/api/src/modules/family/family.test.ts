import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { ValidationError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createFamilyRepo } from "./repo.js";
import { createFamilyService } from "./service.js";
import { createFamilyTools } from "./tools.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const mak = createEldersService({ repo: createEldersRepo(db), clock }).findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const family = createFamilyService({ repo: createFamilyRepo(db), clock, log: silentLogger });
  return { mak, family, tools: createFamilyTools(family) };
}

describe("FamilyService", () => {
  it("registers a family member with a normalised number", () => {
    const { mak, family } = setup();
    const member = family.register(mak.id, { phone: "012-345 6789", name: "Aisyah" });
    expect(member).toMatchObject({ elderId: mak.id, phone: "+60123456789", name: "Aisyah" });
    expect(member.id).toMatch(/^fam_/);
  });

  it("updates rather than duplicates the same number, keeping a known name", () => {
    const { mak, family } = setup();
    const first = family.register(mak.id, { phone: "0123456789", name: "Aisyah" });
    const again = family.register(mak.id, { phone: "+60123456789" });
    expect(again).toEqual(first);
    expect(family.list(mak.id)).toHaveLength(1);
  });

  it("rejects an invalid number", () => {
    const { mak, family } = setup();
    expect(() => family.register(mak.id, { phone: "123" })).toThrow(ValidationError);
  });

  it("notifies every family member through the given messenger", async () => {
    const { mak, family } = setup();
    family.register(mak.id, { phone: "0123456789", name: "Aisyah" });
    family.register(mak.id, { phone: "0198765432", name: "Hafiz" });
    const messenger = new CapturingMessenger();

    await expect(family.notify(mak, "fake Maybank SMS", messenger)).resolves.toEqual({ delivered: 2, total: 2 });
    expect(messenger.sent.map((m) => m.to)).toEqual(["+60123456789", "+60198765432"]);
    expect(messenger.sent[0]!.body).toContain("Mak just received a likely scam (fake Maybank SMS)");
  });

  it("reports failed deliveries and the no-family case", async () => {
    const { mak, family } = setup();
    await expect(family.notify(mak, "x", new CapturingMessenger())).resolves.toEqual({ delivered: 0, total: 0 });
    family.register(mak.id, { phone: "0123456789" });
    await expect(family.notify(mak, "x", new CapturingMessenger(false))).resolves.toEqual({ delivered: 0, total: 1 });
  });
});

describe("family tools", () => {
  it("register_family returns guidance for an invalid number", async () => {
    const { mak, tools } = setup();
    const result = await tools.register_family!.run({ phone: "123" }, testContext({ elder: mak }));
    expect(result).toContain("012-3456789");
  });

  it("notify_family asks for a number when none is saved, then alerts", async () => {
    const { mak, tools } = setup();
    const messenger = new CapturingMessenger();
    const ctx = testContext({ elder: mak, messenger });

    await expect(tools.notify_family!.run({ summary: "fake parcel SMS" }, ctx)).resolves.toContain("No family number saved yet");
    await tools.register_family!.run({ phone: "0123456789", name: "Aisyah" }, ctx);
    await expect(tools.notify_family!.run({ summary: "fake parcel SMS" }, ctx)).resolves.toBe("Alerted 1 of 1 family member(s).");
    expect(messenger.sent).toHaveLength(1);
  });

  it("notify_family is honest when delivery fails", async () => {
    const { mak, tools, family } = setup();
    family.register(mak.id, { phone: "0123456789" });
    const ctx = testContext({ elder: mak, messenger: new CapturingMessenger(false) });
    await expect(tools.notify_family!.run({ summary: "x" }, ctx)).resolves.toContain("could not be delivered");
  });
});
