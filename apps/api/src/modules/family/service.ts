import type { Elder, FamilyMember } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import { normalizePhone } from "../../phone.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { FamilyRepo } from "./repo.js";

const TELEGRAM_PREFIX = "telegram:";

/** One scam means one message to the family: a repeat alert inside this window is skipped. */
const REALERT_WINDOW_MS = 30 * 60 * 1000;

export interface NotifyOptions {
  /** The elder already clicked, paid or shared details: a call-now message. */
  urgent?: boolean;
}

export interface FamilyService {
  register(elderId: string, input: { phone: string; name?: string | null }): FamilyMember;
  list(elderId: string): FamilyMember[];
  listAll(): FamilyMember[];
  /**
   * Marks someone who already chats with CareGuard as an elder's family (labelled on the dashboard).
   * Their channel address is stored as the family "phone"; a Telegram person is alerted in their chat.
   */
  labelAsFamily(elderId: string, person: Elder): FamilyMember;
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
    listAll: () => repo.listAll(),
    labelAsFamily(elderId, person) {
      if (person.id === elderId) throw new ValidationError("Someone can't be marked as their own family.");
      const member = repo.upsert({
        id: newId("fam"),
        elderId,
        name: person.name,
        phone: person.phone,
        telegramChatId: null,
        createdAt: clock.now().toISOString(),
      });
      if (!person.phone.startsWith(TELEGRAM_PREFIX)) return member;
      const chatId = person.phone.slice(TELEGRAM_PREFIX.length);
      return repo.linkTelegramByPhone(person.phone, chatId).find((m) => m.elderId === elderId) ?? member;
    },
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
      // One message per destination, even if the same person was added twice (by number and from the dashboard).
      const destinations = [
        ...new Set(members.map((member) => (member.telegramChatId ? `telegram:${member.telegramChatId}` : member.phone))),
      ];
      const results = await Promise.all(destinations.map((to) => messenger.send({ to, body })));
      const delivered = results.filter(Boolean).length;
      if (delivered > 0) lastAlertAt.set(elder.id, clock.now().getTime());
      if (delivered < destinations.length) {
        log.warn("family alert partly undelivered", { elderId: elder.id, delivered, total: destinations.length });
      }
      return { delivered, total: destinations.length };
    },
  };
}
