import { describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";

describe("openDb", () => {
  it("applies migrations and creates every table", () => {
    const db = openDb(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    expect(tables).toEqual(
      expect.arrayContaining(["elders", "events", "family_members", "messages", "reminders", "schema_migrations"]),
    );
  });

  it("does not re-apply migrations", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toEqual([]);
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db
        .prepare(
          "INSERT INTO events (id, elder_id, type, severity, summary, created_at) VALUES ('evt_x', 'eld_missing', 'scam_detected', 'high', 's', '2026-09-13T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
