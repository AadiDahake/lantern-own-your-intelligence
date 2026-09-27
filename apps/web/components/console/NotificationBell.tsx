"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRelativeTime, reportCountLabel } from "@/lib/console/format";
import type { Notification } from "@/lib/console/notifications";

/** When the reader last opened the bell. Per browser, because "unread" is a personal thing. */
const SEEN_KEY = "lantern.notifications.seen";
const POLL_MS = 60_000;

function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSeen(value: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, value);
  } catch {
    // A browser with storage turned off simply counts everything as unread.
  }
}

/** Issues and pull requests the worker opened, newest first, with an unread count. */
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  // Read once at mount. The list itself only arrives from the API afterwards, so the first
  // render agrees with the server either way.
  const [seen, setSeen] = useState(() => (typeof window === "undefined" ? "" : readSeen()));
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/notifications");
        const body = (await response.json()) as { notifications?: Notification[] };
        if (live) setItems(body.notifications ?? []);
      } catch {
        // The bell is not worth an error message; it simply stays as it was.
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const unread = useMemo(() => items.filter((item) => item.at > seen).length, [items, seen]);

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      const newest = items[0]?.at;
      if (next && newest) {
        writeSeen(newest);
        setSeen(newest);
      }
      return next;
    });
  }, [items]);

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className={`bell__trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unread === 0
            ? "What the agent opened on GitHub"
            : `What the agent opened on GitHub, ${unread} new`
        }
        onClick={toggle}
      >
        <BellGlyph />
        {unread > 0 ? <span className="bell__count">{unread}</span> : null}
      </button>

      {open ? (
        <div className="bell__menu" role="menu">
          <div className="bell__head">On GitHub</div>
          {items.length === 0 ? (
            <p className="bell__empty">No requests filed yet.</p>
          ) : (
            <ul className="bell__list">
              {items.map((item) => (
                <li key={item.id}>
                  <a className="bell__item" href={item.url} target="_blank" rel="noreferrer">
                    <span className="bell__item-title">{item.title}</span>
                    <span className="bell__item-meta">
                      {item.kind === "issue" ? "Issue" : "Pull request"}
                      {item.number === null ? "" : ` #${item.number}`}
                      {` · ${reportCountLabel(item.reportCount, item.userReportCount).toLowerCase()}`}
                      {item.at ? ` · ${formatRelativeTime(item.at)}` : ""}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BellGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3.2.7 5 1.5 6H4.5C5.3 14 6 12.2 6 9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.7 18a2.4 2.4 0 0 0 4.6 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
