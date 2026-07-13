import type { RadarEvent } from "@tissue/shared";
import { formatBpsPct, formatClock, formatMarketKey, formatMs } from "@/lib/format";
import { ClassBadge } from "./ClassBadge";

export function RadarList({ events }: { events: readonly RadarEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="empty">
        No radar events yet. The latency radar publishes reactions as the corpus
        replays.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {events.map((event, i) => (
        <li
          key={`${event.eventTs}-${i}`}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "baseline",
            padding: "8px 0",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span className="muted">{formatClock(event.eventTs)}</span>
          <ClassBadge signalClass={event.signalClass} />
          <span>{formatMarketKey(event.marketKey)}</span>
          <span className="muted">{event.triggerEvent.kind}</span>
          <span className="accent">{formatBpsPct(event.magnitudeBps)}</span>
          {event.reactionLatencyMs !== undefined ? (
            <span className="muted">reaction {formatMs(event.reactionLatencyMs)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
