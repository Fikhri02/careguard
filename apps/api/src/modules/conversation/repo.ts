import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Db } from "../../infra/db.js";

export function createConversationRepo(db: Db) {
  const insert = db.prepare(
    "INSERT INTO messages (elder_id, external_id, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING",
  );

  return {
    /** Returns false when `externalId` was already stored. */
    insert(elderId: string, payload: ChatCompletionMessageParam, createdAt: string, externalId: string | null): boolean {
      return insert.run(elderId, externalId, JSON.stringify(payload), createdAt).changes === 1;
    },
    insertMany(elderId: string, payloads: ChatCompletionMessageParam[], createdAt: string): void {
      db.transaction(() => {
        for (const payload of payloads) insert.run(elderId, null, JSON.stringify(payload), createdAt);
      })();
    },
    recent(elderId: string, limit: number): ChatCompletionMessageParam[] {
      const rows = db
        .prepare("SELECT payload FROM messages WHERE elder_id = ? ORDER BY id DESC LIMIT ?")
        .all(elderId, limit) as { payload: string }[];
      return rows.reverse().map((row) => JSON.parse(row.payload) as ChatCompletionMessageParam);
    },
  };
}

export type ConversationRepo = ReturnType<typeof createConversationRepo>;
