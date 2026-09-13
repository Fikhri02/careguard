import type { StreamMessage } from "@careguard/shared";
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { ConflictError, NotFoundError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "./bus.js";
import { createEventsRepo } from "./repo.js";
import { createEventsService, REASSURANCE } from "./service.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const messenger = new CapturingMessenger();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const bus = createEventBus();
  const published: StreamMessage[] = [];
  bus.subscribe((message) => published.push(message));
  const events = createEventsService({ repo: createEventsRepo(db), bus, messenger, elders, clock, log: silentLogger });
  const mak = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const tok = elders.findOrCreateByPhone("whatsapp:+60199999999", "Tok");
  return { clock, messenger, events, published, mak, tok };
}

const scam = (elderId: string) => ({
  elderId,
  type: "scam_detected" as const,
  severity: "high" as const,
  summary: "Likely scam",
  detail: { reasons: ["asks for TAC"] },
});

describe("EventsService", () => {
  it("records an event, persists it, and publishes event.created", () => {
    const { events, published, mak } = setup();
    const event = events.record(scam(mak.id));

    expect(event).toMatchObject({
      elderId: mak.id,
      type: "scam_detected",
      severity: "high",
      status: "new",
      detail: { reasons: ["asks for TAC"] },
      createdAt: "2026-09-13T03:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(event.id).toMatch(/^evt_/);
    expect(events.get(event.id)).toEqual(event);
    expect(published).toEqual([{ type: "event.created", event }]);
  });

  it("defaults detail to an empty object", () => {
    const { events, mak } = setup();
    const event = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    expect(events.get(event.id).detail).toEqual({});
  });

  it("lists newest first and applies every filter", () => {
    const { events, clock, mak, tok } = setup();
    const first = events.record(scam(mak.id));
    clock.set("2026-09-13T04:00:00.000Z");
    const second = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    clock.set("2026-09-13T05:00:00.000Z");
    const third = events.record(scam(tok.id));

    expect(events.list().map((e) => e.id)).toEqual([third.id, second.id, first.id]);
    expect(events.list({ elderId: mak.id }).map((e) => e.id)).toEqual([second.id, first.id]);
    expect(events.list({ severity: "high" }).map((e) => e.id)).toEqual([third.id, first.id]);
    expect(events.list({ since: "2026-09-13T03:30:00.000Z" }).map((e) => e.id)).toEqual([third.id, second.id]);
    events.dismiss(first.id);
    expect(events.list({ status: "new" }).map((e) => e.id)).toEqual([third.id, second.id]);
  });

  it("approving a scam event reassures the elder exactly once", async () => {
    const { events, messenger, published, clock, mak } = setup();
    const event = events.record(scam(mak.id));
    clock.set("2026-09-13T03:05:00.000Z");

    const approved = await events.approve(event.id);

    expect(approved).toMatchObject({ status: "approved", resolvedAt: "2026-09-13T03:05:00.000Z", resolvedBy: null });
    expect(messenger.sent).toEqual([{ to: mak.phone, body: REASSURANCE }]);
    expect(published.at(-1)).toEqual({ type: "event.updated", event: approved });

    await expect(events.approve(event.id)).rejects.toThrow(ConflictError);
    expect(messenger.sent).toHaveLength(1);
  });

  it("approving a low-severity event does not message the elder", async () => {
    const { events, messenger, mak } = setup();
    const event = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    await events.approve(event.id);
    expect(messenger.sent).toEqual([]);
  });

  it("dismisses without messaging and rejects a second decision", async () => {
    const { events, messenger, mak } = setup();
    const event = events.record(scam(mak.id));
    expect(events.dismiss(event.id).status).toBe("dismissed");
    expect(messenger.sent).toEqual([]);
    await expect(events.approve(event.id)).rejects.toThrow(ConflictError);
  });

  it("throws NotFoundError for unknown ids", async () => {
    const { events } = setup();
    expect(() => events.get("evt_missing")).toThrow(NotFoundError);
    expect(() => events.dismiss("evt_missing")).toThrow(NotFoundError);
    await expect(events.approve("evt_missing")).rejects.toThrow(NotFoundError);
  });
});
