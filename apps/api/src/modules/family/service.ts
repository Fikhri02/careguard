import type { Elder, FamilyMember } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import { normalizePhone } from "../../phone.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { FamilyRepo } from "./repo.js";

export interface FamilyService {
  register(elderId: string, input: { phone: string; name?: string | null }): FamilyMember;
  list(elderId: string): FamilyMember[];
  /** The messenger is per turn, so simulated turns capture alerts instead of sending them. */
  notify(elder: Elder, summary: string, messenger: Messenger): Promise<{ delivered: number; total: number }>;
}

export function createFamilyService({ repo, clock, log }: { repo: FamilyRepo; clock: Clock; log: Logger }): FamilyService {
  return {
    register(elderId, { phone, name = null }) {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new ValidationError(`"${phone}" is not a valid phone number.`);
      return repo.upsert({ id: newId("fam"), elderId, name, phone: normalized, createdAt: clock.now().toISOString() });
    },
    list: (elderId) => repo.listByElder(elderId),
    async notify(elder, summary, messenger) {
      const members = repo.listByElder(elder.id);
      if (members.length === 0) return { delivered: 0, total: 0 };

      const who = elder.name ?? "Your family member";
      const body =
        `⚠️ CareGuard alert: ${who} just received a likely scam (${summary}). ` +
        "I've told them not to click anything or share any details. It might be worth a quick call to check in.";
      const results = await Promise.all(members.map((member) => messenger.send({ to: member.phone, body })));
      const delivered = results.filter(Boolean).length;
      if (delivered < members.length) {
        log.warn("family alert partly undelivered", { elderId: elder.id, delivered, total: members.length });
      }
      return { delivered, total: members.length };
    },
  };
}
