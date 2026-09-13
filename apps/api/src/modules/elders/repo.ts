import type { Elder } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface ElderRow {
  id: string;
  phone: string;
  name: string | null;
  language: string | null;
  created_at: string;
}

const toElder = (r: ElderRow): Elder => ({
  id: r.id,
  phone: r.phone,
  name: r.name,
  language: r.language,
  createdAt: r.created_at,
});

export function createEldersRepo(db: Db) {
  return {
    findByPhone(phone: string): Elder | undefined {
      const row = db.prepare("SELECT * FROM elders WHERE phone = ?").get(phone) as ElderRow | undefined;
      return row && toElder(row);
    },
    get(id: string): Elder | undefined {
      const row = db.prepare("SELECT * FROM elders WHERE id = ?").get(id) as ElderRow | undefined;
      return row && toElder(row);
    },
    list(): Elder[] {
      return (db.prepare("SELECT * FROM elders ORDER BY created_at, rowid").all() as ElderRow[]).map(toElder);
    },
    insert(elder: Elder): void {
      db.prepare("INSERT INTO elders (id, phone, name, language, created_at) VALUES (?, ?, ?, ?, ?)").run(
        elder.id,
        elder.phone,
        elder.name,
        elder.language,
        elder.createdAt,
      );
    },
  };
}

export type EldersRepo = ReturnType<typeof createEldersRepo>;
