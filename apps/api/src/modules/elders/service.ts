import type { Elder } from "@careguard/shared";
import { NotFoundError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { EldersRepo } from "./repo.js";

export interface EldersService {
  findOrCreateByPhone(phone: string, name?: string | null): Elder;
  get(id: string): Elder;
  list(): Elder[];
}

export function createEldersService({ repo, clock }: { repo: EldersRepo; clock: Clock }): EldersService {
  return {
    // better-sqlite3 is synchronous, so find-then-insert cannot interleave with another request.
    findOrCreateByPhone(phone, name = null) {
      const existing = repo.findByPhone(phone);
      if (existing) return existing;
      const elder: Elder = { id: newId("eld"), phone, name, language: null, createdAt: clock.now().toISOString() };
      repo.insert(elder);
      return elder;
    },
    get(id) {
      const elder = repo.get(id);
      if (!elder) throw new NotFoundError(`Elder ${id} not found`);
      return elder;
    },
    list: () => repo.list(),
  };
}
