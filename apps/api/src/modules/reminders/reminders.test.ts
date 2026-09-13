import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createInProcessScheduler } from "../../adapters/in-process-scheduler.js";
import { ValidationError } from "../../errors.js";
import type { Db } from "../../infra/db.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "../events/bus.js";
import { createEventsRepo } from "../events/repo.js";
import { createEventsService } from "../events/service.js";
import { createRemindersRepo } from "./repo.js";
import { createRemindersService } from "./service.js";
import { createReminderTools } from "./tools.js";

function build(db: Db) {
  const clock = fixedClock("2026-09-13T03:00:00.000Z");
  const messenger = new CapturingMessenger();
  const scheduler = createInProcessScheduler(clock, silentLogger);
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const events = createEventsService({ repo: createEventsRepo(db), bus: createEventBus(), messenger, elders, clock, log: silentLogger });
  const reminders = createRemindersService({ repo: createRemindersRepo(db), elders, events, messenger, scheduler, clock, log: silentLogger });
  const mak = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  return { clock, messenger, scheduler, events, reminders, mak, tools: createReminderTools(reminders) };
}

describe("RemindersService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a reminder without a time, records an event, and schedules nothing", () => {
    const { reminders, scheduler, events, mak } = build(createTestDb());
    const reminder = reminders.create(mak, { what: "Pay TNB bill RM143", dueText: "before 25 September" });

    expect(reminder).toMatchObject({ elderId: mak.id, dueAt: null, status: "scheduled" });
    expect(scheduler.size()).toBe(0);
    expect(events.list({ elderId: mak.id })).toMatchObject([
      { type: "reminder_created", severity: "low", summary: "Reminder set: Pay TNB bill RM143 — before 25 September" },
    ]);
  });

  it("sends a WhatsApp nudge when a timed reminder is due", async () => {
    const { reminders, messenger, mak } = build(createTestDb());
    const reminder = reminders.create(mak, { what: "Pay TNB bill RM143", dueText: "in one hour", dueAt: "2026-09-13T12:00:00+08:00" });
    expect(reminder.dueAt).toBe("2026-09-13T04:00:00.000Z");

    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(messenger.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]).toMatchObject({ to: mak.phone });
    expect(messenger.sent[0]!.body).toContain("Pay TNB bill RM143");
    expect(reminders.list(mak.id)[0]!.status).toBe("sent");
  });

  it("does not schedule a reminder whose time has already passed", () => {
    const { reminders, scheduler, mak } = build(createTestDb());
    reminders.create(mak, { what: "x", dueText: "yesterday", dueAt: "2026-09-12T09:00:00+08:00" });
    expect(scheduler.size()).toBe(0);
  });

  it("rejects a dueAt that is not an ISO date-time", () => {
    const { reminders, mak } = build(createTestDb());
    expect(() => reminders.create(mak, { what: "x", dueText: "soon", dueAt: "25 September" })).toThrow(ValidationError);
  });

  it("reschedules pending reminders after a restart", async () => {
    const db = createTestDb();
    const before = build(db);
    before.reminders.create(before.mak, { what: "Klinik appointment", dueText: "at noon", dueAt: "2026-09-13T12:00:00+08:00" });
    before.scheduler.cancel(before.reminders.list()[0]!.id); // simulate the process dying

    const after = build(db);
    expect(after.reminders.restorePending()).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(after.messenger.sent).toHaveLength(1);
  });

  it("create_reminder tool reports the outcome to the model", async () => {
    const { tools, mak } = build(createTestDb());
    const ctx = testContext({ elder: mak });
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "at noon", dueAt: "2026-09-13T12:00:00+08:00" }, ctx)).resolves.toBe(
      "Reminder set for at noon. I'll send a WhatsApp nudge then.",
    );
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "next week" }, ctx)).resolves.toBe(
      'Reminder saved: "Pay bill" — next week.',
    );
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "soon", dueAt: "soon" }, ctx)).resolves.toContain(
      "Could not set that time",
    );
  });
});
