import type { Elder, FamilyMember } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import { normalizePhone } from "../../phone.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { FamilyRepo } from "./repo.js";

/** One scam means one message to the family: a repeat alert inside this window is skipped. */
const REALERT_WINDOW_MS = 30 * 60 * 1000;

export interface NotifyOptions {
  /** The elder already clicked, paid or shared details: a call-now message. */
  urgent?: boolean;
}

export interface FamilyService {
  register(elderId: string, input: { phone: string; name?: string | null }): FamilyMember;
  list(elderId: string): FamilyMember[];
  /** The messenger is per turn, so simulated turns capture alerts instead of sending them. */
  notify(elder: Elder, summary: string, messenger: Messenger, options?: NotifyOptions): Promise<{ delivered: number; total: number }>;
  /** True when the family received an alert about this elder in the last 30 minutes. */
  alertedRecently(elderId: string): boolean;
  /** Called when someone shares their number with the Telegram bot. Returns the family entries now linked. */
  linkTelegram(rawPhone: string, chatId: string): FamilyMember[];
}

export function createFamilyService({ repo, clock, log }: { repo: FamilyRepo; clock: Clock; log: Logger }): FamilyService {
  // In memory on purpose: after a restart the worst case is one extra alert.
  const lastAlertAt = new Map<string, number>();

  return {
    register(elderId, { phone, name = null }) {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new ValidationError(`"${phone}" is not a valid phone number.`);
      return repo.upsert({
        id: newId("fam"),
        elderId,
        name,
        phone: normalized,
        telegramChatId: null,
        createdAt: clock.now().toISOString(),
      });
    },
    linkTelegram(rawPhone, chatId) {
      const normalized = normalizePhone(rawPhone);
      return normalized ? repo.linkTelegramByPhone(normalized, chatId) : [];
    },
    list: (elderId) => repo.listByElder(elderId),
    alertedRecently(elderId) {
      const at = lastAlertAt.get(elderId);
      return at !== undefined && clock.now().getTime() - at < REALERT_WINDOW_MS;
    },
    async notify(elder, summary, messenger, { urgent = false } = {}) {
      const members = repo.listByElder(elder.id);
      if (members.length === 0) return { delivered: 0, total: 0 };

      const who = elder.name ?? "Your family member";
      const body = urgent
        ? `🚨 CareGuard urgent: ${who} may have already clicked a scam link or shared bank details (${summary}). ` +
          "I've told them to call their bank's 24-hour hotline and NSRC at 997. Please call them now."
        : `⚠️ CareGuard alert: ${who} just received a likely scam (${summary}). ` +
          "I've told them not to click anything or share any details. It might be worth a quick call to check in.";
      // A member who linked Telegram is alerted there; otherwise by phone (WhatsApp).
      const results = await Promise.all(
        members.map((member) =>
          messenger.send({ to: member.telegramChatId ? `telegram:${member.telegramChatId}` : member.phone, body }),
        ),
      );
      const delivered = results.filter(Boolean).length;
      if (delivered > 0) lastAlertAt.set(elder.id, clock.now().getTime());
      if (delivered < members.length) {
        log.warn("family alert partly undelivered", { elderId: elder.id, delivered, total: members.length });
      }
      return { delivered, total: members.length };
    },
  };
}
