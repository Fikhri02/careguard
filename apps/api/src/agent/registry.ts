import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { EventsService } from "../modules/events/service.js";
import type { FamilyService } from "../modules/family/service.js";
import { createFamilyTools } from "../modules/family/tools.js";
import type { ProtectService } from "../modules/protect/service.js";
import { createProtectTools } from "../modules/protect/tools.js";
import type { RemindersService } from "../modules/reminders/service.js";
import { createReminderTools } from "../modules/reminders/tools.js";
import type { UnderstandService } from "../modules/understand/service.js";
import { createUnderstandTools } from "../modules/understand/tools.js";
import type { Search } from "../ports/search.js";
import type { ToolSet } from "./tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

export interface ToolServices {
  protect: ProtectService;
  events: EventsService;
  family: FamilyService;
  reminders: RemindersService;
  understand: UnderstandService;
  search: Search;
}

export function buildTools(s: ToolServices): ToolSet {
  return {
    ...createProtectTools(s.protect, s.events),
    ...createFamilyTools(s.family),
    ...createReminderTools(s.reminders),
    ...createUnderstandTools(s.understand),
    ...createWebSearchTool(s.search),
  };
}

export function toolSchemas(tools: ToolSet): ChatCompletionTool[] {
  return Object.values(tools).map((tool) => tool.schema);
}
