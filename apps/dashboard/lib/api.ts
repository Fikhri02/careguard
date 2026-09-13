import type { CareEvent, EventListResponse, ListEventsQuery } from "@careguard/shared";

export const API_URL = process.env.API_URL ?? "http://localhost:8787";

export async function listEvents(query: ListEventsQuery = {}): Promise<CareEvent[]> {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const res = await fetch(`${API_URL}/api/events?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return ((await res.json()) as EventListResponse).events;
}
