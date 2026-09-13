import type { Reminder, ReminderStatus } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface ReminderRow {
  id: string;
  elder_id: string;
  what: string;
  due_text: string;
  due_at: string | null;
  status: string;
  job_id: string | null;
  created_at: string;
}

const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  elderId: r.elder_id,
  what: r.what,
  dueText: r.due_text,
  dueAt: r.due_at,
  status: r.status as ReminderStatus,
  createdAt: r.created_at,
});

export function createRemindersRepo(db: Db) {
  return {
    insert(reminder: Reminder): void {
      db.prepare(
        "INSERT INTO reminders (id, elder_id, what, due_text, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(reminder.id, reminder.elderId, reminder.what, reminder.dueText, reminder.dueAt, reminder.status, reminder.createdAt);
    },
    get(id: string): Reminder | undefined {
      const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow | undefined;
      return row && toReminder(row);
    },
    list(elderId?: string): Reminder[] {
      const rows = elderId
        ? db.prepare("SELECT * FROM reminders WHERE elder_id = ? ORDER BY created_at DESC, rowid DESC").all(elderId)
        : db.prepare("SELECT * FROM reminders ORDER BY created_at DESC, rowid DESC").all();
      return (rows as ReminderRow[]).map(toReminder);
    },
    listScheduledWithDueAt(): Reminder[] {
      return (
        db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND due_at IS NOT NULL").all() as ReminderRow[]
      ).map(toReminder);
    },
    setJobId(id: string, jobId: string): void {
      db.prepare("UPDATE reminders SET job_id = ? WHERE id = ?").run(jobId, id);
    },
    markSent(id: string): void {
      db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(id);
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
