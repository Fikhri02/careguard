import type { FamilyMember } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface FamilyRow {
  id: string;
  elder_id: string;
  name: string | null;
  phone: string;
  telegram_chat_id: string | null;
  created_at: string;
}

const toMember = (r: FamilyRow): FamilyMember => ({
  id: r.id,
  elderId: r.elder_id,
  name: r.name,
  phone: r.phone,
  telegramChatId: r.telegram_chat_id,
  createdAt: r.created_at,
});

export function createFamilyRepo(db: Db) {
  function find(elderId: string, phone: string): FamilyMember | undefined {
    const row = db.prepare("SELECT * FROM family_members WHERE elder_id = ? AND phone = ?").get(elderId, phone) as
      | FamilyRow
      | undefined;
    return row && toMember(row);
  }

  return {
    /** Inserts, or keeps the existing row for this (elder, phone) and fills in a missing name. */
    upsert(member: FamilyMember): FamilyMember {
      db.prepare(
        `INSERT INTO family_members (id, elder_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (elder_id, phone) DO UPDATE SET name = COALESCE(excluded.name, family_members.name)`,
      ).run(member.id, member.elderId, member.name, member.phone, member.createdAt);
      return find(member.elderId, member.phone)!;
    },
    /** Links every family entry with this phone to a Telegram chat. Returns the linked entries. */
    linkTelegramByPhone(phone: string, chatId: string): FamilyMember[] {
      db.prepare("UPDATE family_members SET telegram_chat_id = ? WHERE phone = ?").run(chatId, phone);
      return (
        db.prepare("SELECT * FROM family_members WHERE phone = ? ORDER BY created_at, rowid").all(phone) as FamilyRow[]
      ).map(toMember);
    },
    listAll(): FamilyMember[] {
      return (db.prepare("SELECT * FROM family_members ORDER BY created_at, rowid").all() as FamilyRow[]).map(toMember);
    },
    listByElder(elderId: string): FamilyMember[] {
      return (
        db.prepare("SELECT * FROM family_members WHERE elder_id = ? ORDER BY created_at, rowid").all(elderId) as FamilyRow[]
      ).map(toMember);
    },
  };
}

export type FamilyRepo = ReturnType<typeof createFamilyRepo>;
