import type { CareEvent, EventType, ListEventsQuery, Severity } from "@careguard/shared";
import { ConflictError, NotFoundError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { EldersService } from "../elders/service.js";
import type { EventBus } from "./bus.js";
import type { EventsRepo } from "./repo.js";

export interface RecordEventInput {
  elderId: string;
  type: EventType;
  severity: Severity;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface EventsService {
  record(input: RecordEventInput): CareEvent;
  list(query?: ListEventsQuery): CareEvent[];
  get(id: string): CareEvent;
  approve(id: string, by?: string | null): Promise<CareEvent>;
  dismiss(id: string, by?: string | null): CareEvent;
}

/** Sent to the elder when family approves a high-risk event. Wording is tuned on event day. */
export const REASSURANCE =
  "Anak awak dah tengok amaran tadi dan setuju — awak selamat. Jangan klik apa-apa link atau beri OTP ya. 💙\n\n" +
  "Your family has seen the warning and agrees — you're safe. Please don't click any link or share any OTP. 💙";

const REASSURE_ON: ReadonlySet<EventType> = new Set(["scam_detected", "high_risk_action"]);

export interface EventsDeps {
  repo: EventsRepo;
  bus: EventBus;
  messenger: Messenger;
  elders: EldersService;
  clock: Clock;
  log: Logger;
}

export function createEventsService({ repo, bus, messenger, elders, clock, log }: EventsDeps): EventsService {
  function get(id: string): CareEvent {
    const event = repo.get(id);
    if (!event) throw new NotFoundError(`Event ${id} not found`);
    return event;
  }

  function decide(id: string, status: "approved" | "dismissed", by: string | null): CareEvent {
    const current = get(id);
    if (!repo.decide(id, status, clock.now().toISOString(), by)) {
      throw new ConflictError(`Event ${id} is already ${current.status}`);
    }
    const updated = get(id);
    bus.publish({ type: "event.updated", event: updated });
    return updated;
  }

  return {
    record(input) {
      const event: CareEvent = {
        id: newId("evt"),
        elderId: input.elderId,
        type: input.type,
        severity: input.severity,
        summary: input.summary,
        detail: input.detail ?? {},
        status: "new",
        createdAt: clock.now().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
      };
      repo.insert(event);
      bus.publish({ type: "event.created", event });
      return event;
    },
    list: (query = {}) => repo.list(query),
    get,
    async approve(id, by = null) {
      const approved = decide(id, "approved", by);
      if (REASSURE_ON.has(approved.type)) {
        const elder = elders.get(approved.elderId);
        const delivered = await messenger.send({ to: elder.phone, body: REASSURANCE });
        if (!delivered) log.warn("reassurance not delivered", { eventId: id, elderId: elder.id });
      }
      return approved;
    },
    dismiss: (id, by = null) => decide(id, "dismissed", by),
  };
}
