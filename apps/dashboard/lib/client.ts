import type { ApiError, CareEvent, Elder, ElderListResponse } from "@careguard/shared";

/** Browser-side calls. Relative URLs go through this app's rewrite to the API. */

export type Decision = "approve" | "dismiss";

export class DecisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

export async function decide(id: string, decision: Decision): Promise<CareEvent> {
  let res: Response;
  try {
    res = await fetch(`/api/events/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
  } catch {
    throw new DecisionError("network", "Couldn’t reach CareGuard. Check the API is running, then try again.");
  }
  if (res.ok) return (await res.json()) as CareEvent;
  const body = (await res.json().catch(() => null)) as ApiError | null;
  throw new DecisionError(body?.error.code ?? "unknown", body?.error.message ?? `CareGuard responded ${res.status}.`);
}

/** A message from the family to their relative, sent on the chat app CareGuard uses with them. Resolves to whether it was delivered. */
export async function sendToElder(elderId: string, text: string): Promise<boolean> {
  const res = await fetch(`/api/elders/${encodeURIComponent(elderId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error.message ?? `CareGuard responded ${res.status}.`);
  }
  return ((await res.json()) as { delivered: boolean }).delivered;
}

export async function fetchElders(): Promise<Elder[]> {
  try {
    const res = await fetch("/api/elders");
    if (!res.ok) return [];
    return ((await res.json()) as ElderListResponse).elders;
  } catch {
    return [];
  }
}
