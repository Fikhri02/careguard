import { describe, expect, it } from "vitest";
import { CareEvent, ListEventsQuery, SimulateRequest, StreamMessage } from "./index.js";

const event = {
  id: "evt_1",
  elderId: "eld_1",
  type: "scam_detected",
  severity: "high",
  summary: "Likely scam",
  detail: { reasons: ["asks for TAC"] },
  status: "new",
  createdAt: "2026-09-13T03:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

describe("shared contracts", () => {
  it("accepts a valid CareEvent", () => {
    expect(CareEvent.parse(event)).toEqual(event);
  });

  it("rejects an unknown severity", () => {
    expect(CareEvent.safeParse({ ...event, severity: "critical" }).success).toBe(false);
  });

  it("validates event list filters", () => {
    expect(ListEventsQuery.parse({ status: "new", severity: "high" })).toEqual({ status: "new", severity: "high" });
    expect(ListEventsQuery.safeParse({ status: "open" }).success).toBe(false);
    expect(ListEventsQuery.safeParse({ since: "yesterday" }).success).toBe(false);
    expect(ListEventsQuery.safeParse({ since: "2026-09-13T03:00:00.000Z" }).success).toBe(true);
  });

  it("requires a phone and non-empty text to simulate", () => {
    expect(SimulateRequest.safeParse({ phone: "+60123456789", text: "" }).success).toBe(false);
    expect(SimulateRequest.safeParse({ phone: "+60123456789", text: "Hai" }).success).toBe(true);
  });

  it("wraps events in stream messages", () => {
    expect(StreamMessage.parse({ type: "event.created", event }).event.id).toBe("evt_1");
  });
});
