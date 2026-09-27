"use client";

import { outcomeLabel, outcomeTone } from "@/lib/agent/outcome";
import {
  formatDateTime,
  formatDuration,
  reportCountLabel,
  requestStatusLabel,
} from "@/lib/console/format";
import { replayUrl } from "@/lib/console/replay";

import type { ConversationDetail, ConversationTurn } from "@/lib/console/conversations";

/** The right-hand panel: what happened, then the transcript with the guidance under each turn. */
export function ConversationDetailPanel({
  detail,
  siteUrl,
  loading,
  error,
}: {
  detail: ConversationDetail | null;
  siteUrl: string | null;
  loading: boolean;
  error: string;
}) {
  const replay = detail?.outcome === "solved" ? replayUrl(siteUrl, detail.question) : null;

  return (
    <section className="trace-panel">
      <div className="trace-panel__head">
        <div className="min-w-0">
          {detail ? (
            <span className={`outcome-badge ${outcomeTone(detail.outcome)}`}>
              {outcomeLabel(detail.outcome)}
            </span>
          ) : null}
          <h2 className="trace-panel__title mt-2">
            {detail?.question ?? (loading ? "Loading" : "No conversation selected")}
          </h2>
          {detail ? (
            <div className="detail-meta">
              {detail.pageTitle ? <span>{detail.pageTitle}</span> : null}
              <span>{formatDateTime(detail.createdAt)}</span>
              <span>{formatDuration(detail.durationMs)}</span>
              <span>
                {detail.messageCount} message{detail.messageCount === 1 ? "" : "s"}
              </span>
              {detail.closeReason ? <span>{detail.closeReason}</span> : null}
            </div>
          ) : null}
        </div>
        {replay ? (
          <a className="trace-link" href={replay} target="_blank" rel="noreferrer">
            Replay on site
            <span aria-hidden>&rarr;</span>
          </a>
        ) : null}
      </div>

      <div className="trace-body">
        {error ? (
          <div className="notice is-error" role="alert">
            {error}
          </div>
        ) : !detail ? (
          <p className="trace-row__text">
            {loading ? "Loading the transcript." : "Choose a conversation on the left."}
          </p>
        ) : (
          <>
            {detail.summary ? (
              <section className="detail-section">
                <h3 className="detail-section__title">What happened</h3>
                <p className="detail-summary">{detail.summary}</p>
              </section>
            ) : null}

            {detail.resolution ? (
              <section className="detail-section">
                <h3 className="detail-section__title">
                  {detail.outcome === "solved" ? "Resolution" : "Where it was left"}
                </h3>
                <p className="detail-summary">{detail.resolution}</p>
              </section>
            ) : null}

            {detail.group ? <GroupCard group={detail.group} /> : null}

            <Bullets title="Evidence" items={detail.evidence} quoted />
            <Bullets title="Next steps" items={detail.nextSteps} />

            <section className="detail-section">
              <h3 className="detail-section__title">Transcript</h3>
              {detail.messages.length === 0 ? (
                <p className="trace-row__text">No messages were stored for this conversation.</p>
              ) : (
                <ol className="transcript">
                  {detail.messages.map((turn) => (
                    <TranscriptRow key={turn.id} turn={turn} escalation={detail.escalation} />
                  ))}
                </ol>
              )}
            </section>

            {detail.memory.length > 0 ? (
              <section className="detail-section">
                <h3 className="detail-section__title">What the agent remembers</h3>
                <ul className="memory-list">
                  {detail.memory.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The request this conversation was filed under.
 *
 * One person's question is rarely only theirs, so the panel says which gap it joined and how much
 * weight that gap now carries, and links to the request itself.
 */
function GroupCard({ group }: { group: NonNullable<ConversationDetail["group"]> }) {
  return (
    <section className="detail-section">
      <h3 className="detail-section__title">Filed under</h3>
      <div className="request-card">
        <h4>{group.title}</h4>
        <p>
          {reportCountLabel(group.reportCount, group.userReportCount)} &middot; {group.priority}{" "}
          priority &middot; {requestStatusLabel(group.status)}
        </p>
        <div className="trace-links mt-3">
          <a className="trace-link" href={`/console/activity?request=${group.id}`}>
            See the request
            <span aria-hidden>&rarr;</span>
          </a>
          {group.issueUrl ? (
            <a className="trace-link" href={group.issueUrl} target="_blank" rel="noreferrer">
              {`Issue #${group.issueNumber ?? ""}`.trim()}
              <span aria-hidden>&rarr;</span>
            </a>
          ) : null}
          {group.prUrl ? (
            <a className="trace-link" href={group.prUrl} target="_blank" rel="noreferrer">
              Pull request
              <span aria-hidden>&rarr;</span>
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** A short list the model produced, or nothing at all when it produced none. */
function Bullets({
  title,
  items,
  quoted = false,
}: {
  title: string;
  items: string[] | null;
  /** Evidence is the user's own words, so it is shown as a quotation. */
  quoted?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="detail-section">
      <h3 className="detail-section__title">{title}</h3>
      <ul className={`detail-bullets${quoted ? " is-quoted" : ""}`}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function TranscriptRow({
  turn,
  escalation,
}: {
  turn: ConversationTurn;
  escalation: ConversationDetail["escalation"];
}) {
  const agent = turn.role === "assistant";
  const steps = agent ? (turn.steps ?? []) : [];
  const request = agent ? turn.featureRequest : null;

  return (
    <li className={`transcript__row ${agent ? "is-agent" : "is-user"}`}>
      <span className="transcript__role">{agent ? "Agent" : "Asked"}</span>
      <p className="transcript__text">{turn.content}</p>

      {steps.length > 0 ? (
        <>
          <span className="turn-steps__label">Shown on the page</span>
          <ol className="turn-steps">
            {steps.map((step, index) => (
              <li key={`${step.target}-${index}`}>{step.caption}</li>
            ))}
          </ol>
        </>
      ) : null}

      {turn.feedback ? (
        <p className="turn-feedback">
          {turn.feedback.rating === "up"
            ? "The visitor said this answer helped"
            : "The visitor said this answer did not help"}
          {turn.feedback.note ? `: ${turn.feedback.note}` : "."}
        </p>
      ) : null}

      {request ? (
        <div className="request-card">
          <h4>{request.title}</h4>
          <p>{request.description}</p>
          {escalation ? <RequestLinks escalation={escalation} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function RequestLinks({
  escalation,
}: {
  escalation: NonNullable<ConversationDetail["escalation"]>;
}) {
  const links = [
    escalation.issueUrl
      ? { href: escalation.issueUrl, label: `Issue #${escalation.issueNumber ?? ""}`.trim() }
      : null,
    escalation.prUrl
      ? { href: escalation.prUrl, label: `Pull request #${escalation.prNumber ?? ""}`.trim() }
      : null,
  ].filter((link): link is { href: string; label: string } => link !== null);

  if (links.length === 0) return null;

  return (
    <div className="trace-links mt-3">
      {links.map((link) => (
        <a key={link.href} className="trace-link" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
          <span aria-hidden>&rarr;</span>
        </a>
      ))}
    </div>
  );
}
