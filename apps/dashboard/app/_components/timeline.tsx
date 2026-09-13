import type { CareEvent, Elder } from "@careguard/shared";
import { EVENT_LABEL, elderLabel, relativeTime, statusLabel } from "../../lib/format";

interface TimelineProps {
  events: CareEvent[];
  elders: ReadonlyMap<string, Elder>;
  now: number | null;
}

export function Timeline({ events, elders, now }: TimelineProps) {
  if (events.length === 0) {
    return <p className="empty">No activity yet. What CareGuard does for your family shows up here.</p>;
  }

  return (
    <ol className="timeline">
      {events.map((event) => {
        const status = statusLabel(event);
        return (
          <li key={event.id} className="tl-item" data-severity={event.severity}>
            <span className="tl-dot" aria-hidden="true" />
            <div>
              <p className="tl-head">
                <span className="tl-label">{EVENT_LABEL[event.type]}</span>
                <span>{elderLabel(elders, event.elderId)}</span>
                <time dateTime={event.createdAt}>{now === null ? "" : relativeTime(event.createdAt, now)}</time>
              </p>
              <p className="tl-summary">{event.summary}</p>
            </div>
            <span className={`chip chip-${status.tone}`}>{status.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
