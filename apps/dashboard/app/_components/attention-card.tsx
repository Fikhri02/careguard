import type { CareEvent } from "@careguard/shared";
import type { Decision } from "../../lib/client";
import { EVENT_LABEL, isExample, reasonsOf, relativeTime, urlsOf } from "../../lib/format";

interface AttentionCardProps {
  event: CareEvent;
  elderName: string;
  now: number | null;
  pending: Decision | undefined;
  onDecide: (event: CareEvent, decision: Decision) => void;
}

export function AttentionCard({ event, elderName, now, pending, onDecide }: AttentionCardProps) {
  const reasons = reasonsOf(event).slice(0, 3);
  const urls = urlsOf(event);
  const busy = pending !== undefined;
  const titleId = `alert-${event.id}`;

  return (
    <article className="alert" aria-labelledby={titleId}>
      <div className="alert-meta">
        <span className="chip chip-risk">{event.severity === "high" ? "High risk" : "Medium risk"}</span>
        <span>{EVENT_LABEL[event.type]}</span>
        <span aria-hidden="true">·</span>
        <span className="who">{elderName}</span>
        {isExample(event) && <span className="chip chip-example">Example</span>}
        <time className="alert-time" dateTime={event.createdAt}>
          {now === null ? "" : relativeTime(event.createdAt, now)}
        </time>
      </div>

      <h3 id={titleId}>{event.summary}</h3>

      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {urls.length > 0 && (
        <p className="links">
          {urls.length === 1 ? "Link" : "Links"}:
          {urls.map((url) => (
            <code key={url}>{url}</code>
          ))}
        </p>
      )}

      <div className="alert-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(event, "approve")}>
          {pending === "approve" ? "Approving…" : `Approve and reassure ${elderName}`}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => onDecide(event, "dismiss")}>
          {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
      <p className="alert-hint">Approving sends {elderName} a message saying the family has seen it and they’re safe.</p>
    </article>
  );
}
