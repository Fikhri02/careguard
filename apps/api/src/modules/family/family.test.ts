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
  return { mak, family, clock, tools: createFamilyTools(family) };
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

  it("links a family member's Telegram chat by phone and alerts them there", async () => {
    const { mak, family } = setup();
    family.register(mak.id, { phone: "012-345 6789", name: "Aisyah" });

    // Telegram shares contacts as digits without a plus sign.
    const linked = family.linkTelegram("60123456789", "555001");
    expect(linked).toMatchObject([{ name: "Aisyah", phone: "+60123456789", telegramChatId: "555001" }]);

    const messenger = new CapturingMessenger();
    await expect(family.notify(mak, "fake Maybank SMS", messenger)).resolves.toEqual({ delivered: 1, total: 1 });
    expect(messenger.sent.map((m) => m.to)).toEqual(["telegram:555001"]);
  });

  it("links nobody when the shared number was never registered", () => {
    const { family } = setup();
    expect(family.linkTelegram("0199999999", "555002")).toEqual([]);
    expect(family.linkTelegram("not a number", "555003")).toEqual([]);
  });

  it("remembers a delivered alert for 30 minutes", async () => {
    const { mak, family, clock } = setup();
    family.register(mak.id, { phone: "0123456789" });
    expect(family.alertedRecently(mak.id)).toBe(false);

    await family.notify(mak, "x", new CapturingMessenger(false));
    expect(family.alertedRecently(mak.id)).toBe(false);

    await family.notify(mak, "x", new CapturingMessenger());
    expect(family.alertedRecently(mak.id)).toBe(true);

    clock.set("2026-09-13T03:31:00.000Z");
    expect(family.alertedRecently(mak.id)).toBe(false);
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

  it("notify_family doesn't alert twice, except with an urgent already-shared alert", async () => {
    const { mak, tools, family } = setup();
    family.register(mak.id, { phone: "0123456789" });
    const messenger = new CapturingMessenger();
    const ctx = testContext({ elder: mak, messenger });

    await tools.notify_family!.run({ summary: "fake Maybank SMS" }, ctx);
    await expect(tools.notify_family!.run({ summary: "fake Maybank SMS" }, ctx)).resolves.toContain("already alerted");
    await tools.notify_family!.run({ summary: "fake Maybank SMS", alreadyShared: true }, ctx);

    expect(messenger.sent).toHaveLength(2);
    expect(messenger.sent[1]!.body).toContain("Please call them now");
  });

  it("notify_family is honest when delivery fails", async () => {
    const { mak, tools, family } = setup();
    family.register(mak.id, { phone: "0123456789" });
    const ctx = testContext({ elder: mak, messenger: new CapturingMessenger(false) });
    await expect(tools.notify_family!.run({ summary: "x" }, ctx)).resolves.toContain("could not be delivered");
  });
});
