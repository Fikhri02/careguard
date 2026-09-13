import type { CareEvent } from "@careguard/shared";
import { API_URL, listEvents } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let events: CareEvent[] = [];
  let error: string | null = null;
  try {
    events = await listEvents();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main>
      <h1>CareGuard — family dashboard (shell)</h1>
      {error ? (
        <p>
          Could not reach the API at {API_URL}: {error}
        </p>
      ) : events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              [{event.severity}] {event.type} — {event.summary} ({event.status})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
