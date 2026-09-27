import type { OpportunityDetail } from "@/lib/opportunity/read";

const GRADES = ["1", "2", "3", "4", "5"];

function Bars({ title, counts }: { title: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return (
    <div>
      <p className="detail-section__title">{title}</p>
      <div className="opp-bars">
        {GRADES.map((grade) => {
          const n = counts[grade] ?? 0;
          return (
            <div className="opp-bar" key={grade}>
              <span>{grade}</span>
              <span className="opp-bar__track">
                <span className="opp-bar__fill" style={{ width: total ? `${Math.round((n / total) * 100)}%` : "0%" }} />
              </span>
              <span>{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Stage 2: the inferred intent, and its reward. The two axes are kept apart on purpose: a
 * session that wandered and then succeeded scores high on completion and low on coherence, and
 * that pairing is the workaround signal.
 */
export function IntentCard({ intent }: { intent: OpportunityDetail["intent"] }) {
  const graded = Object.values(intent.completion).reduce((sum, n) => sum + n, 0);
  if (!intent.name && graded === 0) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>Inferred intent</h2>
        </div>
        <p className="opp-quiet">The goal behind the sessions is inferred once they are mined.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Inferred intent</h2>
        {intent.name ? <code className="mono">{intent.name}</code> : null}
      </div>
      <div className="opp-facts">
        <div className="opp-fact">
          <span className="opp-fact__num is-text">{intent.sentence ?? intent.name ?? "-"}</span>
          <span className="opp-fact__label">What the sessions were trying to do</span>
          <span className="opp-fact__note">
            {intent.sessions} session{intent.sessions === 1 ? "" : "s"} share this goal. Every session was read as a
            demonstration and the goal recovered from its steps, not asked of the user.
          </span>
        </div>
      </div>
      <div className="opp-columns">
        <Bars title="Completion: did the final state show the goal reached" counts={intent.completion} />
        <Bars title="Coherence: was the path a logical pursuit of it" counts={intent.coherence} />
      </div>
      <p className="opp-quiet" style={{ marginTop: 12 }}>
        High completion with low coherence is the workaround: the person got there, the hard way. Those
        sessions are kept with their weight, not filtered out.
      </p>
    </section>
  );
}
