import type { CareEvent, Elder, ElderListResponse, EventListResponse, ListEventsQuery } from "@careguard/shared";

/** Server-side only: where the Next.js server reaches the CareGuard API. */
export const API_URL = process.env.API_URL ?? "http://localhost:8787";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return (await res.json()) as T;
}

export async function listEvents(query: ListEventsQuery = {}): Promise<CareEvent[]> {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return (await getJson<EventListResponse>(`/api/events?${params}`)).events;
}

export async function listElders(): Promise<Elder[]> {
  return (await getJson<ElderListResponse>("/api/elders")).elders;
}
