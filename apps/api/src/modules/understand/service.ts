import type { CareEvent, DocumentKind, Elder } from "@careguard/shared";
import type { EventsService } from "../events/service.js";

export interface UnderstandService {
  logDocument(elder: Elder, input: { kind: DocumentKind; summary: string }): CareEvent;
}

export function createUnderstandService({ events }: { events: EventsService }): UnderstandService {
  return {
    logDocument: (elder, { kind, summary }) =>
      events.record({ elderId: elder.id, type: "bill_explained", severity: "low", summary, detail: { kind } }),
  };
}
