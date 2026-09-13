import type { Db } from "./infra/db.js";
import { createConversationRepo } from "./modules/conversation/repo.js";
import { createConversationService, type ConversationService } from "./modules/conversation/service.js";
import { createEldersRepo } from "./modules/elders/repo.js";
import { createEldersService, type EldersService } from "./modules/elders/service.js";
import { createEventBus, type EventBus } from "./modules/events/bus.js";
import { createEventsRepo } from "./modules/events/repo.js";
import { createEventsService, type EventsService } from "./modules/events/service.js";
import { createFamilyRepo } from "./modules/family/repo.js";
import { createFamilyService, type FamilyService } from "./modules/family/service.js";
import { createProtectService, type ProtectService } from "./modules/protect/service.js";
import { createRemindersRepo } from "./modules/reminders/repo.js";
import { createRemindersService, type RemindersService } from "./modules/reminders/service.js";
import { createUnderstandService, type UnderstandService } from "./modules/understand/service.js";
import type { Clock } from "./ports/clock.js";
import type { Logger } from "./ports/logger.js";
import type { Messenger } from "./ports/messenger.js";
import type { Scheduler } from "./ports/scheduler.js";
import type { Search } from "./ports/search.js";
import type { UrlReputation } from "./ports/url-reputation.js";

export interface ServiceDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  /** Process-wide messenger: approvals and reminder nudges. Turns receive their own via ToolContext. */
  messenger: Messenger;
  scheduler: Scheduler;
  search: Search;
  urlReputation: UrlReputation;
}

export interface Services {
  elders: EldersService;
  conversation: ConversationService;
  events: EventsService;
  family: FamilyService;
  reminders: RemindersService;
  understand: UnderstandService;
  protect: ProtectService;
  bus: EventBus;
}

export function createServices({ db, clock, log, messenger, scheduler, search, urlReputation }: ServiceDeps): Services {
  const bus = createEventBus();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const conversation = createConversationService({ repo: createConversationRepo(db), clock });
  const events = createEventsService({ repo: createEventsRepo(db), bus, messenger, elders, clock, log });
  const family = createFamilyService({ repo: createFamilyRepo(db), clock, log });
  const reminders = createRemindersService({ repo: createRemindersRepo(db), elders, events, messenger, scheduler, clock, log });
  const understand = createUnderstandService({ events });
  const protect = createProtectService({ search, urlReputation });
  return { elders, conversation, events, family, reminders, understand, protect, bus };
}
