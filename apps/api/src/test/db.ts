import { openDb, type Db } from "../infra/db.js";

export function createTestDb(): Db {
  return openDb(":memory:");
}
