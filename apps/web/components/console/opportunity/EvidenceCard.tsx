import type { Discovery } from "@lantern/shared";
import { formatMedian } from "@/lib/console/format";
import type { OpportunityDetail } from "@/lib/opportunity/read";
import { Fact } from "./Stage";

/**
 * Stage 1: the user workflows. PostHog is named here, once, as the evidence source: the session
 * count, the two medians, the common intent, and three sessions rendered step by step with a
 * link to watch each one.
 */
export function EvidenceCard({
  evidence,
  intent,
  discovery,
  status,
}: {
  evidence: OpportunityDetail["evidence"];
  intent: OpportunityDetail["intent"];
  discovery: Discovery | null;
  status: OpportunityDetail["status"];
}) {
  const running = discovery?.status === "queued" || discovery?.status === "running";
  // Before a specification exists the count is the mined pool; after, the sessions behind the intent.
  const compiled = !["discovering", "failed", "not_warranted"].includes(status);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Evidence</h2>
        {running ? (
          <span className="opp-live">
            <span className="opp-live__dot" />
            {discovery?.stage === "compiling" ? "Compiling the capability" : "Mining sessions from PostHog"}
          </span>
        ) : null}
      </div>

      {evidence.sessionCount === null && !running ? (
        <p className="opp-quiet">
          {status === "failed"
            ? `The last discovery failed: ${discovery?.error ?? "no reason recorded"}.`
            : "No sessions have been mined for this gap yet."}
        </p>
      ) : null}

      {evidence.sessionCount !== null ? (
        <div className="opp-facts">
          <Fact
            value={String(evidence.sessionCount)}
            label="Matching PostHog sessions"
            note={compiled ? "Successful sessions that share the inferred intent." : "Successful seat-map sessions in the window, before the intent is inferred."}
          />
          <Fact
            value={formatMedian(evidence.medianInteractions)}
            label="Median seat-map interactions"
            note="As the product counts them: seat clicks, refused clicks and passenger picks."
          />
          <Fact
            value={formatMedian(evidence.medianManualActions)}
            label="Median manual steps"
            note="Every manual step, scanning included. What one call would replace."
          />
          <Fact value={intent.sentence ?? intent.name ?? "-"} label="Common intent" text />
        </div>
      ) : null}

      {status === "not_warranted" && discovery ? (
        <p className="opp-quiet">
          No capability was warranted: {discovery.reasons.join("; ") || "the sessions did not share one workaround"}.
        </p>
      ) : null}

      {evidence.representative.length > 0 ? (
        <>
          <p className="detail-section__title">Three of the {evidence.sessionCount} sessions, step by step</p>
          <div className="opp-columns">
            {evidence.representative.map((trajectory) => (
              <article className="opp-traj" key={trajectory.sessionId}>
                <div className="opp-traj__head">
                  <p className="opp-traj__label">{trajectory.label}</p>
                  {trajectory.replayUrl ? (
                    <a className="ext-link" href={trajectory.replayUrl} target="_blank" rel="noreferrer">
                      Watch this session
                    </a>
                  ) : (
                    <span className="opp-traj__meta">No recording</span>
                  )}
                </div>
                <p className="opp-traj__meta">
                  {trajectory.manualActions} manual step{trajectory.manualActions === 1 ? "" : "s"}
                  {trajectory.refusals > 0 ? `, ${trajectory.refusals} refused` : ""}
                  {trajectory.reward
                    ? ` - completion ${trajectory.reward.completion ?? "-"}, coherence ${trajectory.reward.coherence ?? "-"}`
                    : ""}
                </p>
                <ol className="opp-steps">
                  {trajectory.steps.map((step, index) => (
                    <li key={index}>
                      {step.line}
                      {index > 0 ? <span className="opp-steps__delta"> +{step.seconds}s</span> : null}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
          {evidence.replayCount > 0 ? (
            <p className="opp-quiet" style={{ marginTop: 12 }}>
              {evidence.replayCount} of {evidence.poolCount} mined sessions have a recording.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
