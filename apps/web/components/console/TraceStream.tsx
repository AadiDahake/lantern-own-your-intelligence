"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@lantern/shared";
import { TraceRow } from "./TraceRow";

/**
 * The trace for one selection: backfilled once, then tailed over `EventSource`.
 *
 * The parent gives this a `key` of the query, so changing selection remounts it and the events
 * start empty without anything having to reset them.
 */
export function TraceStream({
  query,
  escalationId,
  onDecision,
  onCount,
  onLive,
}: {
  query: string;
  escalationId: string | null;
  onDecision: () => void;
  onCount: (count: number) => void;
  onLive: (live: boolean) => void;
}) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);
  // Autoscroll follows the tail, but stops the moment the reader scrolls up to read something.
  const pinned = useRef(true);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;

    void (async () => {
      let cursor = 0;
      try {
        const response = await fetch(`/api/trace?${query}&limit=500`);
        const payload = (await response.json()) as { events?: TraceEvent[]; error?: string };
        if (!active) return;
        if (payload.error) setError(payload.error);
        const backfill = payload.events ?? [];
        setEvents(backfill);
        cursor = backfill.length > 0 ? (backfill[backfill.length - 1]?.id ?? 0) : 0;
      } catch {
        if (active) setError("Could not load the trace.");
      }

      if (!active) return;
      source = new EventSource(`/api/trace/stream?${query}&since=${cursor}`);
      source.addEventListener("open", () => onLive(true));
      source.addEventListener("trace", (message) => {
        try {
          const event = JSON.parse((message as MessageEvent<string>).data) as TraceEvent;
          setEvents((current) =>
            current.some((existing) => existing.id === event.id) ? current : [...current, event],
          );
        } catch {
          // A malformed frame is not worth interrupting the stream for.
        }
      });
      source.addEventListener("error", () => onLive(false));
    })();

    return () => {
      active = false;
      source?.close();
      onLive(false);
    };
  }, [query, onLive]);

  useEffect(() => {
    onCount(events.length);
    const node = body.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [events, onCount]);

  return (
    <div
      className="trace-body"
      ref={body}
      onScroll={(scrollEvent) => {
        const node = scrollEvent.currentTarget;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      }}
    >
      {error ? (
        <div className="notice is-error" role="alert">
          {error}
        </div>
      ) : null}
      {events.length === 0 ? (
        <p className="trace-row__text">
          No trace rows for this selection yet. New ones stream in as they happen.
        </p>
      ) : (
        events.map((event) => (
          <TraceRow
            key={event.id}
            event={event}
            escalationId={event.escalationId ?? escalationId}
            onDecision={onDecision}
          />
        ))
      )}
    </div>
  );
}
