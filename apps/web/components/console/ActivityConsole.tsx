"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { RequestGroup } from "@lantern/shared";
import { outcomeLabel, outcomeTone } from "@/lib/agent/outcome";
import {
  formatDateTime,
  reportCountLabel,
  requestStatusLabel,
  requestStatusTone,
} from "@/lib/console/format";
import { TraceStream } from "./TraceStream";

import type { ConversationSummary } from "@/lib/console/conversations";

type Conversation = ConversationSummary;

type Selection = { kind: "request"; id: string } | { kind: "conversation"; id: string };

type Filter = "all" | "requests" | "conversations";

const FILTERS: Filter[] = ["all", "requests", "conversations"];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  requests: "Requests",
  conversations: "Conversations",
};

export function ActivityConsole({
  initialRequests,
  initialConversations,
}: {
  initialRequests: RequestGroup[];
  initialConversations: Conversation[];
}) {
  // A conversation links to the request it joined, so arrive on that one when asked.
  const requested = useSearchParams().get("request");
  const [requests, setRequests] = useState<RequestGroup[]>(initialRequests);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [filter, setFilter] = useState<Filter>("all");
  const [chosen, setChosen] = useState<Selection | null>(
    requested ? { kind: "request", id: requested } : null,
  );
  const [eventCount, setEventCount] = useState(0);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");

  /** Re-read the two lists after a decision, so the counts and the links catch up. */
  const refresh = useCallback(async () => {
    try {
      const [requestResponse, conversationResponse] = await Promise.all([
        fetch("/api/requests"),
        fetch("/api/conversations?limit=40"),
      ]);
      const requestBody = (await requestResponse.json()) as { requests?: RequestGroup[] };
      const conversationBody = (await conversationResponse.json()) as {
        conversations?: Conversation[];
      };
      setRequests(requestBody.requests ?? []);
      setConversations(conversationBody.conversations ?? []);
    } catch {
      setError("Could not refresh the activity list.");
    }
  }, []);

  const handleDecision = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Nothing chosen yet means the heaviest request, or failing that the newest conversation.
  const selection = useMemo<Selection | null>(() => {
    if (chosen) return chosen;
    const request = requests[0];
    if (request) return { kind: "request", id: request.id };
    const conversation = conversations[0];
    return conversation ? { kind: "conversation", id: conversation.id } : null;
  }, [chosen, requests, conversations]);

  const selectedRequest =
    selection?.kind === "request" ? (requests.find((row) => row.id === selection.id) ?? null) : null;
  const selectedConversation =
    selection?.kind === "conversation"
      ? (conversations.find((row) => row.id === selection.id) ?? null)
      : null;

  const query = useMemo(() => {
    if (!selection) return null;
    const params = new URLSearchParams();
    if (selection.kind === "request") {
      // A request's story starts before any run: the chat that noticed it and the pipeline that
      // mined and compiled it carry the group id; the run that builds it carries the escalation.
      params.set("groupId", selection.id);
      if (selectedRequest?.escalationId) params.set("escalationId", selectedRequest.escalationId);
    } else {
      params.set("conversationId", selection.id);
    }
    return params.toString();
  }, [selection, selectedRequest]);

  const showRequests = filter !== "conversations";
  const showConversations = filter !== "requests";
  const nothingToShow =
    (showRequests ? requests.length : 0) + (showConversations ? conversations.length : 0) === 0;

  // With nothing recorded the filters count nothing three ways. One empty state says more.
  if (requests.length === 0 && conversations.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">Nothing has happened yet</p>
        <p className="empty-state__text">
          Install the widget on your site. The first question shows up here, with every check,
          decision and artefact behind it.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="filter-row">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`filter-chip${filter === value ? " is-active" : ""}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {FILTER_LABEL[value]}
            <span className="filter-chip__count">
              {value === "all"
                ? requests.length + conversations.length
                : value === "requests"
                  ? requests.length
                  : conversations.length}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice is-error mb-4" role="alert">
          {error}
        </div>
      ) : null}

      <div className="activity-grid">
        <div className="list-column">
          {nothingToShow ? (
            <div className="empty-state">
              <p className="empty-state__title">Nothing under this filter</p>
              <p className="empty-state__text">Try another one.</p>
            </div>
          ) : (
            <ul className="record-list">
              {showRequests &&
                requests.map((request) => (
                  <li key={request.id}>
                    <RequestCard
                      request={request}
                      selected={selection?.kind === "request" && selection.id === request.id}
                      onSelect={() => setChosen({ kind: "request", id: request.id })}
                    />
                  </li>
                ))}

              {showConversations &&
                conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`record-card${
                        selection?.kind === "conversation" && selection.id === conversation.id
                          ? " is-selected"
                          : ""
                      }`}
                      onClick={() => setChosen({ kind: "conversation", id: conversation.id })}
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
                        {conversation.question ?? conversation.pageTitle ?? "Conversation"}
                      </p>
                      {conversation.pageTitle ? (
                        <p className="record-card__line is-clipped" title={conversation.pageTitle}>
                          <span className="record-card__label">Page</span>
                          {conversation.pageTitle}
                        </p>
                      ) : null}
                      <div className="record-card__meta">
                        <span>
                          {conversation.messageCount} message
                          {conversation.messageCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <section className="trace-panel">
          <div className="trace-panel__head">
            <div className="min-w-0">
              <h2 className="trace-panel__title">
                {selectedRequest?.title ??
                  (selectedConversation
                    ? (selectedConversation.question ?? "Conversation")
                    : "Live trace")}
              </h2>
              <p className="trace-panel__meta">
                {selectedRequest
                  ? reportCountLabel(selectedRequest.reportCount, selectedRequest.userReportCount)
                  : selection
                    ? `${eventCount} event${eventCount === 1 ? "" : "s"}`
                    : "Choose a request or a conversation."}
              </p>
            </div>
            <span className={`trace-live${live ? " is-live" : ""}`}>
              <span className="trace-live__dot" />
              {live ? "Live" : "Idle"}
            </span>
          </div>

          {selectedRequest ? <ArtifactLinks request={selectedRequest} /> : null}

          {query && selection ? (
            <TraceStream
              key={query}
              query={query}
              escalationId={selectedRequest?.escalationId ?? null}
              onDecision={handleDecision}
              onCount={setEventCount}
              onLive={setLive}
            />
          ) : (
            <div className="trace-body">
              <p className="trace-row__text">
                {selectedRequest
                  ? "Nothing has run for this request yet. It is on the list, waiting for enough weight behind it."
                  : "Nothing selected."}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/** One gap in the product: how it is doing, and how many people it has caught. */
function RequestCard({
  request,
  selected,
  onSelect,
}: {
  request: RequestGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`record-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="record-card__top">
        <span className={`outcome-badge ${requestStatusTone(request.status)}`}>
          {requestStatusLabel(request.status)}
        </span>
        <span className="record-card__time">{formatDateTime(request.lastSeen)}</span>
      </div>
      <p className="record-card__summary">{request.title}</p>
      <p className="record-card__line">
        <span className="record-card__label">Priority</span>
        {request.priority}
      </p>
      <div className="record-card__meta">
        <span>{reportCountLabel(request.reportCount, request.userReportCount)}</span>
        {request.issueNumber !== null ? <span>issue #{request.issueNumber}</span> : null}
        {request.prUrl ? <span>pull request</span> : null}
      </div>
    </button>
  );
}

/** The request's own artefacts, always reachable without hunting through the trace. */
function ArtifactLinks({ request }: { request: RequestGroup }) {
  const links = [
    request.issueUrl
      ? { href: request.issueUrl, label: `Issue #${request.issueNumber ?? ""}`.trim() }
      : null,
    request.prUrl ? { href: request.prUrl, label: "Pull request" } : null,
  ].filter((link): link is { href: string; label: string } => link !== null);

  if (links.length === 0) return null;

  return (
    <div className="trace-links trace-panel__links">
      {links.map((link) => (
        <a key={link.href} className="trace-link" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
          <span aria-hidden>&rarr;</span>
        </a>
      ))}
    </div>
  );
}
