"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeLabel, outcomeTone, type ConversationOutcome } from "@/lib/agent/outcome";
import { formatDateTime, formatDuration } from "@/lib/console/format";
import { keepInView } from "@/lib/console/keepInView";
import { ConversationDetailPanel } from "./ConversationDetail";

import type {
  ConversationDetail,
  ConversationSummary,
  OutcomeCounts,
} from "@/lib/console/conversations";

type Filter = "all" | ConversationOutcome;

const FILTERS: Filter[] = ["all", "solved", "product_bug", "missing_feature", "unresolved"];

function filterLabel(filter: Filter): string {
  return filter === "all" ? "All" : outcomeLabel(filter);
}

export function ConversationsConsole({
  initialConversations,
  initialCounts,
  siteUrl,
}: {
  initialConversations: ConversationSummary[];
  initialCounts: OutcomeCounts;
  siteUrl: string | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [counts, setCounts] = useState(initialCounts);
  const [filter, setFilter] = useState<Filter>("all");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  // The first paint already carries the unfiltered list, so only a filter change refetches.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/conversations?limit=60&outcome=${filter}`);
        const body = (await response.json()) as {
          conversations?: ConversationSummary[];
          counts?: OutcomeCounts;
          error?: string;
        };
        if (!live) return;
        if (body.error) throw new Error(body.error);
        setConversations(body.conversations ?? []);
        if (body.counts) setCounts(body.counts);
        setListError("");
      } catch {
        if (live) setListError("Could not load conversations.");
      }
    })();
    return () => {
      live = false;
    };
  }, [filter]);

  // Nothing chosen yet means the newest conversation in the current filter.
  const selectedId = chosenId ?? conversations[0]?.id ?? null;

  // On the stacked layout the list is a short strip, so the chosen card can sit outside it after
  // a filter change. Only the strip is scrolled; the page stays where the reader left it.
  const listBox = useRef<HTMLDivElement | null>(null);
  const selectedCard = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    keepInView(listBox.current, selectedCard.current);
  }, [selectedId, conversations]);

  const load = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError("");
    try {
      const response = await fetch(`/api/conversations/${id}`);
      const body = (await response.json()) as {
        conversation?: ConversationDetail;
        error?: string;
      };
      if (body.error || !body.conversation) throw new Error(body.error ?? "Not found");
      return body.conversation;
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    void (async () => {
      try {
        const conversation = await load(selectedId);
        if (live) setDetail(conversation);
      } catch {
        if (live) {
          setDetail(null);
          setDetailError("Could not open this conversation.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedId, load]);

  // Before the first question the pills would count nothing four ways, so the page says the
  // one thing that is true instead.
  if (counts.all === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No conversations yet</p>
        <p className="empty-state__text">
          Install the widget on your site. Every question the agent handles, how it ended and the
          guidance it gave appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="filter-row" role="group" aria-label="Filter by outcome">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`filter-chip${filter === value ? " is-active" : ""}`}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setChosenId(null);
            }}
          >
            {filterLabel(value)}
            <span className="filter-chip__count">{counts[value] ?? 0}</span>
          </button>
        ))}
      </div>

      {listError ? (
        <div className="notice is-error mb-4" role="alert">
          {listError}
        </div>
      ) : null}

      {conversations.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No conversations match this filter</p>
          <p className="empty-state__text">Try another outcome.</p>
        </div>
      ) : (
        <div className="activity-grid">
          <div className="list-column" ref={listBox}>
            <ul className="record-list">
              {conversations.map((conversation) => (
                <li
                  key={conversation.id}
                  ref={selectedId === conversation.id ? selectedCard : undefined}
                >
                  <button
                    type="button"
                    className={`record-card${selectedId === conversation.id ? " is-selected" : ""}`}
                    onClick={() => setChosenId(conversation.id)}
                  >
                    <div className="record-card__top">
                      <span className={`outcome-badge ${outcomeTone(conversation.outcome)}`}>
                        {outcomeLabel(conversation.outcome)}
                      </span>
                      <span className="record-card__time">
                        {formatDateTime(conversation.createdAt)}
                      </span>
                    </div>
                    <p className="record-card__summary">
                      {conversation.question ?? "Conversation"}
                    </p>
                    {conversation.pageTitle ? (
                      <p className="record-card__line is-clipped" title={conversation.pageTitle}>
                        <span className="record-card__label">Page</span>
                        {conversation.pageTitle}
                      </p>
                    ) : null}
                    <div className="record-card__meta">
                      <span>{formatDuration(conversation.durationMs)}</span>
                      <span>
                        {conversation.messageCount} message
                        {conversation.messageCount === 1 ? "" : "s"}
                      </span>
                      {conversation.escalation?.issueNumber ? (
                        <span>issue #{conversation.escalation.issueNumber}</span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <ConversationDetailPanel
            detail={selectedId ? detail : null}
            siteUrl={siteUrl}
            loading={loadingDetail}
            error={detailError}
          />
        </div>
      )}
    </>
  );
}
