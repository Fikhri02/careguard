// SHARED EVENT STORE — the spine both surfaces read/write (see architecture doc).
// The WhatsApp agent WRITES events; the CopilotKit family dashboard READS them and
// approves/dismisses. In-memory for the hackathon; swap for SQLite/Postgres to persist.

export type EventType = "bill_explained" | "scam_detected" | "high_risk_action" | "reminder_created";
export type Severity = "low" | "med" | "high";
export type EventStatus = "new" | "approved" | "dismissed" | "resolved";

export interface CareEvent {
  id: string;
  elderId: string;
  elderName?: string;
  type: EventType;
  severity: Severity;
  summary: string;
  detail?: Record<string, unknown>;
  status: EventStatus;
  createdAt: string;
}

const events: CareEvent[] = [];
let seq = 1;

export function addEvent(
  e: Omit<CareEvent, "id" | "status" | "createdAt"> & { status?: EventStatus },
): CareEvent {
  const ev: CareEvent = {
    ...e,
    id: `evt_${seq++}`,
    status: e.status ?? "new",
    createdAt: new Date().toISOString(),
  };
  events.unshift(ev); // newest first
  return ev;
}

export function listEvents(filter?: { status?: EventStatus; elderId?: string }): CareEvent[] {
  return events.filter(
    (e) =>
      (!filter?.status || e.status === filter.status) &&
      (!filter?.elderId || e.elderId === filter.elderId),
  );
}

export function getEvent(id: string): CareEvent | undefined {
  return events.find((e) => e.id === id);
}

export function setStatus(id: string, status: EventStatus): CareEvent | undefined {
  const e = getEvent(id);
  if (e) e.status = status;
  return e;
}

// Seed demo events so the dashboard renders something on first load (mark as examples).
addEvent({
  elderId: "demo", elderName: "Mak", type: "bill_explained", severity: "low",
  summary: "Explained a TNB electricity bill — RM143, due 25 Sep. Reminder set.",
  detail: { amount: 143, due: "2026-09-25", example: true },
});
addEvent({
  elderId: "demo", elderName: "Mak", type: "scam_detected", severity: "high",
  summary: "Blocked a fake Maybank 'account suspended' message with a phishing link.",
  detail: { link: "maybank-verify.xyz", reasons: ["asks for TAC", "lookalike domain"], example: true },
});
