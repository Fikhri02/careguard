import type { Elder, Reminder } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { Scheduler } from "../../ports/scheduler.js";
import type { EldersService } from "../elders/service.js";
import type { EventsService } from "../events/service.js";
import type { RemindersRepo } from "./repo.js";

export interface CreateReminderInput {
  what: string;
  dueText: string;
  /** ISO-8601 with a timezone, e.g. 2026-09-24T09:00:00+08:00. */
  dueAt?: string | null;
}

export interface RemindersService {
  create(elder: Elder, input: CreateReminderInput): Reminder;
  list(elderId?: string): Reminder[];
  /** Re-registers scheduled reminders after a restart. Returns how many. */
  restorePending(): number;
}

export interface RemindersDeps {
  repo: RemindersRepo;
  elders: EldersService;
  events: EventsService;
  messenger: Messenger;
  scheduler: Scheduler;
  clock: Clock;
  log: Logger;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function nudgeText(reminder: Reminder): string {
  return `⏰ Peringatan: ${reminder.what} (${reminder.dueText}).\nReminder: ${reminder.what} (${reminder.dueText}).`;
}

export function createRemindersService({ repo, elders, events, messenger, scheduler, clock, log }: RemindersDeps): RemindersService {
  async function nudge(id: string): Promise<void> {
    const reminder = repo.get(id);
    if (!reminder || reminder.status !== "scheduled") return;
    const elder = elders.get(reminder.elderId);
    if (await messenger.send({ to: elder.phone, body: nudgeText(reminder) })) repo.markSent(id);
    else log.warn("reminder nudge not delivered", { reminderId: id });
  }

  function schedule(reminder: Reminder & { dueAt: string }): void {
    const jobId = scheduler.schedule({ id: reminder.id, runAt: new Date(reminder.dueAt), run: () => nudge(reminder.id) });
    repo.setJobId(reminder.id, jobId);
  }

  function parseDueAt(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const time = Date.parse(raw);
    if (!ISO_DATE_TIME.test(raw) || Number.isNaN(time)) throw new ValidationError(`"${raw}" is not an ISO-8601 date-time.`);
    return new Date(time).toISOString();
  }

  return {
    create(elder, input) {
      const reminder: Reminder = {
        id: newId("rem"),
        elderId: elder.id,
        what: input.what,
        dueText: input.dueText,
        dueAt: parseDueAt(input.dueAt),
        status: "scheduled",
        createdAt: clock.now().toISOString(),
      };
      repo.insert(reminder);
      if (reminder.dueAt && Date.parse(reminder.dueAt) > clock.now().getTime()) {
        schedule({ ...reminder, dueAt: reminder.dueAt });
      }
      events.record({
        elderId: elder.id,
        type: "reminder_created",
        severity: "low",
        summary: `Reminder set: ${input.what} — ${input.dueText}`,
        detail: { reminderId: reminder.id, dueAt: reminder.dueAt },
      });
      return reminder;
    },
    list: (elderId) => repo.list(elderId),
    restorePending() {
      const pending = repo.listScheduledWithDueAt();
      for (const reminder of pending) schedule({ ...reminder, dueAt: reminder.dueAt! });
      return pending.length;
    },
  };
}
