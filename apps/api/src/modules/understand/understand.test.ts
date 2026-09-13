import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "../events/bus.js";
import { createEventsRepo } from "../events/repo.js";
import { createEventsService } from "../events/service.js";
import { createUnderstandService } from "./service.js";
import { createUnderstandTools } from "./tools.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const events = createEventsService({
    repo: createEventsRepo(db),
    bus: createEventBus(),
    messenger: new CapturingMessenger(),
    elders,
    clock,
    log: silentLogger,
  });
  const understand = createUnderstandService({ events });
  return { events, understand, tools: createUnderstandTools(understand), mak: elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak") };
}

describe("understand", () => {
  it("logs an explained document as a low bill_explained event", () => {
    const { understand, mak } = setup();
    expect(understand.logDocument(mak, { kind: "letter", summary: "LHDN tax letter — reply by 30 Sep" })).toMatchObject({
      elderId: mak.id,
      type: "bill_explained",
      severity: "low",
      summary: "LHDN tax letter — reply by 30 Sep",
      detail: { kind: "letter" },
    });
  });

  it("log_document tool records the event for the current elder", async () => {
    const { tools, events, mak } = setup();
    await expect(
      tools.log_document!.run({ kind: "bill", summary: "TNB electricity bill — RM143, due 25 Sep" }, testContext({ elder: mak })),
    ).resolves.toBe("Logged for the family timeline.");
    expect(events.list({ elderId: mak.id })).toHaveLength(1);
  });
});
