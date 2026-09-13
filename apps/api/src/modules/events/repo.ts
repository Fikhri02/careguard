import type { CareEvent, EventStatus, EventType, ListEventsQuery, Severity } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface EventRow {
  id: string;
  elder_id: string;
  type: string;
  severity: string;
  summary: string;
  detail: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const toEvent = (r: EventRow): CareEvent => ({
  id: r.id,
  elderId: r.elder_id,
  type: r.type as EventType,
  severity: r.severity as Severity,
  summary: r.summary,
  detail: JSON.parse(r.detail) as Record<string, unknown>,
  status: r.status as EventStatus,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.resolved_by,
});

export function createEventsRepo(db: Db) {
  return {
    insert(event: CareEvent): void {
      db.prepare(
        `INSERT INTO events (id, elder_id, type, severity, summary, detail, status, created_at, resolved_at, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        event.elderId,
        event.type,
        event.severity,
        event.summary,
        JSON.stringify(event.detail),
        event.status,
        event.createdAt,
        event.resolvedAt,
        event.resolvedBy,
      );
    },
    get(id: string): CareEvent | undefined {
      const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
      return row && toEvent(row);
    },
    list(query: ListEventsQuery): CareEvent[] {
      const where: string[] = [];
      const params: string[] = [];
      if (query.elderId) {
        where.push("elder_id = ?");
        params.push(query.elderId);
      }
      if (query.status) {
        where.push("status = ?");
        params.push(query.status);
      }
      if (query.severity) {
        where.push("severity = ?");
        params.push(query.severity);
      }
      if (query.since) {
        where.push("created_at >= ?");
        params.push(query.since);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db
        .prepare(`SELECT * FROM events ${clause} ORDER BY created_at DESC, rowid DESC LIMIT 200`)
        .all(...params) as EventRow[];
      return rows.map(toEvent);
    },
    /** Moves a `new` event to a decided status. Returns false if it was not `new`. */
    decide(id: string, status: "approved" | "dismissed", resolvedAt: string, resolvedBy: string | null): boolean {
      return (
        db
          .prepare("UPDATE events SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'new'")
          .run(status, resolvedAt, resolvedBy, id).changes === 1
      );
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
