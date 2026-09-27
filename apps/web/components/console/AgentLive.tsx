"use client";

import { useEffect, useState } from "react";

/** The worker writes a heartbeat every minute; anything inside this counts as live. */
const ONLINE_WINDOW_MS = 120_000;
const POLL_MS = 30_000;

type StatusEvent = { createdAt?: string };

/**
 * Whether the agent's worker is up, taken from the last heartbeat it wrote.
 *
 * It polls rather than holding the trace stream open, because this sits on pages that are not
 * about the trace and should not keep a connection alive for a single dot.
 */
export function AgentLive() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;

    const check = async (): Promise<void> => {
      try {
        const response = await fetch("/api/trace?kind=status&limit=1&order=desc");
        const body = (await response.json()) as { events?: StatusEvent[] };
        const stamp = body.events?.[0]?.createdAt;
        const seen = stamp ? new Date(stamp).getTime() : Number.NaN;
        if (live) setOnline(Number.isFinite(seen) && Date.now() - seen < ONLINE_WINDOW_MS);
      } catch {
        if (live) setOnline(false);
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <span className="agent-live" aria-live="polite">
      <span className={`stat__dot${online ? "" : " is-off"}`} aria-hidden="true" />
      {online === null ? "Checking the agent" : online ? "Agent live" : "Agent offline"}
    </span>
  );
}
