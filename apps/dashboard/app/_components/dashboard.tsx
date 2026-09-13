"use client";

import type { CareEvent, Elder, StreamMessage } from "@careguard/shared";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decide, DecisionError, fetchElders, sendToElder, type Decision } from "../../lib/client";
import { elderLabel, EVENT_LABEL, isExample, needsAttention, reasonsOf, upsertEvent } from "../../lib/format";
import { AttentionCard } from "./attention-card";
import { Timeline } from "./timeline";

type Connection = "connecting" | "live" | "reconnecting";
type Notice = { tone: "ok" | "error"; text: string };

const COPILOT_INSTRUCTIONS =
  "You are CareGuard's family assistant. You help a family member understand what CareGuard did for their elderly relative. " +
  "Answer only from the CareGuard activity you are given, and never invent events. " +
  "Be warm and brief: a one-line headline, then a few short bullets with times in Malaysia time (UTC+8). " +
  "Put anything that still needs the family's decision first. Say when an item is example demo data. " +
  "If nothing matches the question, say so plainly. " +
  "You can also act, but only when the family member clearly asks you to: approve or dismiss an alert that needs their decision " +
  "(decideAlert, using the alert's id from the activity; never an example item unless they insist), or send their relative a message (sendMessageToElder). " +
  "Write messages to the relative as the family member speaking — short, warm, simple, and in the relative's language (usually Bahasa Melayu). " +
  "After acting, say exactly what you did in one line.";

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

export function Dashboard({ initialEvents, initialElders }: { initialEvents: CareEvent[]; initialElders: Elder[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [elders, setElders] = useState<ReadonlyMap<string, Elder>>(() => new Map(initialElders.map((e) => [e.id, e])));
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pending, setPending] = useState<Record<string, Decision>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Relative times render only after mount, so server and browser markup always match.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("reconnecting"); // EventSource retries on its own
    source.onmessage = (message) => {
      try {
        const { event } = JSON.parse(message.data) as StreamMessage;
        setEvents((list) => upsertEvent(list, event));
      } catch {
        // Ignore anything that isn't a CareGuard stream message.
      }
    };
    return () => source.close();
  }, []);

  // An elder who texts CareGuard for the first time appears in an event before we know their name.
  useEffect(() => {
    const missing = new Set(events.map((e) => e.elderId).filter((id) => !elders.has(id)));
    if (missing.size === 0) return;
    let cancelled = false;
    void fetchElders().then((list) => {
      if (!cancelled && list.some((e) => missing.has(e.id))) setElders(new Map(list.map((e) => [e.id, e])));
    });
    return () => {
      cancelled = true;
    };
  }, [events, elders]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onDecide = useCallback(
    async (event: CareEvent, decision: Decision) => {
      setPending((p) => ({ ...p, [event.id]: decision }));
      try {
        const updated = await decide(event.id, decision);
        setEvents((list) => upsertEvent(list, updated));
        const who = elderLabel(elders, event.elderId);
        setNotice({
          tone: "ok",
          text: decision === "approve" ? `Approved — ${who} is getting a reassuring message.` : "Dismissed — no message was sent.",
        });
      } catch (err) {
        if (err instanceof DecisionError && err.code === "conflict") {
          setNotice({ tone: "error", text: "Someone in the family already handled this alert." });
        } else {
          setNotice({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong. Try again." });
        }
      } finally {
        setPending(({ [event.id]: _done, ...rest }) => rest);
      }
    },
    [elders],
  );

  const attention = useMemo(() => events.filter(needsAttention), [events]);
  const counts = useMemo(
    () => ({
      scams: events.filter((e) => e.type === "scam_detected").length,
      documents: events.filter((e) => e.type === "bill_explained").length,
      reminders: events.filter((e) => e.type === "reminder_created").length,
    }),
    [events],
  );
  const watching = [...elders.values()].map((e) => e.name ?? e.phone.replace(/^whatsapp:/, ""));

  // What the copilot may read: the same activity the family sees, in plain terms.
  const copilotActivity = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        when: e.createdAt,
        elder: elderLabel(elders, e.elderId),
        what: EVENT_LABEL[e.type],
        severity: e.severity,
        status: e.status,
        needsFamilyDecision: needsAttention(e),
        summary: e.summary,
        reasons: reasonsOf(e),
        exampleDemoData: isExample(e),
      })),
    [events, elders],
  );
  useCopilotReadable({
    description: "CareGuard activity for the family, newest first. `when` is ISO-8601 UTC; the family lives in Malaysia (UTC+8).",
    value: copilotActivity,
  });
  useCopilotReadable({ description: "The elderly relatives CareGuard looks after", value: watching });

  // The copilot acts through the same paths as the buttons, so the dashboard updates and notices the same way.
  useCopilotAction(
    {
      name: "decideAlert",
      description:
        "Approve or dismiss a CareGuard alert that needs the family's decision. Approving sends the relative a reassuring message. " +
        "Only call this when the family member asks you to.",
      parameters: [
        { name: "eventId", type: "string", description: "The alert's id from the CareGuard activity", required: true },
        { name: "decision", type: "string", enum: ["approve", "dismiss"], description: "approve or dismiss", required: true },
      ],
      handler: async ({ eventId, decision }) => {
        const event = events.find((e) => e.id === eventId);
        if (!event) return "There is no alert with that id.";
        if (!needsAttention(event)) return `That alert was already ${event.status}.`;
        const choice: Decision = decision === "dismiss" ? "dismiss" : "approve";
        await onDecide(event, choice);
        const who = elderLabel(elders, event.elderId);
        return choice === "approve" ? `Approved — ${who} is getting a reassuring message.` : "Dismissed — no message was sent.";
      },
    },
    [events, elders, onDecide],
  );

  useCopilotAction(
    {
      name: "sendMessageToElder",
      description:
        "Send a short message from the family to their elderly relative, on the chat app CareGuard uses with them. " +
        "Only call this when the family member asks you to tell their relative something.",
      parameters: [
        { name: "elderName", type: "string", description: "Which relative, exactly as listed among the relatives CareGuard looks after", required: true },
        { name: "message", type: "string", description: "The exact message to send, written as the family member speaking", required: true },
      ],
      handler: async ({ elderName, message }) => {
        const list = [...elders.values()];
        const wanted = elderName.trim().toLowerCase();
        const elder = list.find((e) => (e.name ?? "").trim().toLowerCase() === wanted) ?? (list.length === 1 ? list[0] : undefined);
        if (!elder) return `I couldn't tell which relative "${elderName}" is. Ask the family member to pick one of: ${watching.join(", ")}.`;
        const who = elderLabel(elders, elder.id);
        try {
          const delivered = await sendToElder(elder.id, message);
          setNotice(
            delivered
              ? { tone: "ok", text: `Sent to ${who}: “${message}”` }
              : { tone: "error", text: `Couldn't deliver the message to ${who} right now.` },
          );
          return delivered ? `Sent to ${who}: "${message}"` : `The message couldn't be delivered to ${who} right now.`;
        } catch (err) {
          const text = err instanceof Error ? err.message : "Something went wrong.";
          setNotice({ tone: "error", text });
          return `Not sent: ${text}`;
        }
      },
    },
    [elders, watching],
  );

  const firstElder = watching[0] ?? "your family";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1 className="wordmark">CareGuard</h1>
          <span className="brand-sub">
            {watching.length > 0 ? `Looking after ${watching.join(", ")}` : "Family dashboard"}
          </span>
        </div>
        <span className="live" data-state={connection} role="status">
          <span className="live-dot" aria-hidden="true" />
          {CONNECTION_LABEL[connection]}
        </span>
      </header>

      <main className="board">
        <dl className="summary">
          <div className="stat" data-alert={attention.length > 0}>
            <dt>Need you</dt>
            <dd>{attention.length}</dd>
          </div>
          <div className="stat">
            <dt>Scams caught</dt>
            <dd>{counts.scams}</dd>
          </div>
          <div className="stat">
            <dt>Documents explained</dt>
            <dd>{counts.documents}</dd>
          </div>
          <div className="stat">
            <dt>Reminders set</dt>
            <dd>{counts.reminders}</dd>
          </div>
        </dl>

        {notice && (
          <p className={`notice notice-${notice.tone}`} role="status">
            {notice.text}
          </p>
        )}

        <div className="columns">
          <section className="column" aria-labelledby="attention-h">
            <h2 id="attention-h">
              Needs your attention {attention.length > 0 && <span className="chip chip-new">{attention.length}</span>}
            </h2>
            {attention.length === 0 ? (
              <p className="empty">Nothing needs you right now. When CareGuard catches something risky, it appears here straight away.</p>
            ) : (
              attention.map((event) => (
                <AttentionCard
                  key={event.id}
                  event={event}
                  elderName={elderLabel(elders, event.elderId)}
                  now={now}
                  pending={pending[event.id]}
                  onDecide={onDecide}
                />
              ))
            )}
          </section>

          <section className="column" aria-labelledby="activity-h">
            <h2 id="activity-h">Activity</h2>
            <Timeline events={events} elders={elders} now={now} />
          </section>
        </div>
      </main>

      <CopilotPopup
        instructions={COPILOT_INSTRUCTIONS}
        clickOutsideToClose={false}
        labels={{
          title: "Ask CareGuard",
          initial: `Ask me about ${firstElder}’s week, or ask me to act — for example, “Approve the scam alert” or “Tell ${firstElder} I’ll call tonight.”`,
          placeholder: `Ask about ${firstElder}…`,
        }}
      />
    </div>
  );
}
