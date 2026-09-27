"use client";

import { useState } from "react";
import type { DeploymentOutcome } from "@lantern/shared";
import { formatCount, formatDateTime, formatMedian } from "@/lib/console/format";

/**
 * Thirty days later: PostHog's second job. Before the launch, the sessions that worked around the
 * gap; after it, adoption, completion and the change in support volume. The label says whether
 * the figures were measured or seeded; it comes from the row, never from the page.
 */
export function OutcomeCard({
  groupId,
  outcome,
  before,
  hasSpec,
  onChanged,
}: {
  groupId: string;
  outcome: DeploymentOutcome | null;
  before: { sessions: number | null; medianInteractions: number | null };
  hasSpec: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function measure(): Promise<void> {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/opportunities/${groupId}/measure`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Measuring failed (${response.status}).`);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Measuring failed.");
    } finally {
      setPending(false);
    }
  }

  const change = outcome?.supportChangePct ?? null;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Outcome, {outcome ? `${outcome.windowDays} days later` : "30 days later"}</h2>
        {outcome ? (
          <span className={`outcome-badge ${outcome.source === "seeded" ? "is-wait" : "is-good"}`}>
            {outcome.source === "seeded" ? "seeded data" : "measured by PostHog"}
          </span>
        ) : null}
      </div>
      <div className="opp-outcome">
        <div className="opp-outcome__block">
          <p className="opp-outcome__title">Before launch</p>
          <div className="opp-outcome__row">
            <span>Matching manual workflows</span>
            <strong>{formatCount(before.sessions)}</strong>
          </div>
          <div className="opp-outcome__row">
            <span>Median seat-map interactions</span>
            <strong>{formatMedian(outcome?.medianActionsBefore ?? before.medianInteractions)}</strong>
          </div>
        </div>
        <div className="opp-outcome__block">
          <p className="opp-outcome__title">After launch</p>
          {outcome ? (
            <>
              <div className="opp-outcome__row">
                <span>Eligible travelers</span>
                <strong>{formatCount(outcome.eligibleUsers)}</strong>
              </div>
              <div className="opp-outcome__row">
                <span>Feature used</span>
                <strong>{formatCount(outcome.featureUsed)}</strong>
              </div>
              <div className="opp-outcome__row">
                <span>Successful</span>
                <strong>{formatCount(outcome.featureSucceeded)}</strong>
              </div>
              <div className="opp-outcome__row">
                <span>Median interactions</span>
                <strong>
                  {formatMedian(outcome.medianActionsBefore)} to {formatMedian(outcome.medianActionsAfter)}
                </strong>
              </div>
              <div className="opp-outcome__row">
                <span>Seat-related support</span>
                <strong>{change === null ? "-" : `${change > 0 ? "+" : ""}${formatMedian(change)}%`}</strong>
              </div>
              <p className="opp-fact__note">
                {outcome.source === "seeded"
                  ? "These figures are seeded outcome data in PostHog, not customer behaviour. The events carry seeded: true."
                  : "Measured from the capability's own events in PostHog."}{" "}
                Measured {formatDateTime(outcome.measuredAt)}.
              </p>
            </>
          ) : (
            <p className="opp-quiet">
              Not measured yet. Once the capability ships, PostHog reports whether customers use it and whether
              support contacts fall.
            </p>
          )}
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {hasSpec ? (
        <div className="opp-actions">
          <button type="button" className="ghost-action" disabled={pending} onClick={() => void measure()}>
            {pending ? "Measuring..." : outcome ? "Measure again" : "Measure the outcome"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
