import type { CapabilityIR, Slot } from "@lantern/capability";
import type { SpecRow } from "@/lib/opportunity/read";

function slot(s: Slot): string {
  const extras: string[] = [];
  if (s.enum && s.enum.length > 0) extras.push(`one of ${s.enum.map(String).join(", ")}`);
  if (s.range && (s.range.min !== undefined || s.range.max !== undefined)) {
    extras.push(`${s.range.min ?? "-"} to ${s.range.max ?? "-"}`);
  }
  return extras.length ? ` (${extras.join("; ")})` : "";
}

function signatureOf(ir: CapabilityIR): string {
  return `${ir.intent}(${ir.observation.inputs.map((input) => input.name).join(", ")})`;
}

/** The IR without the 63 trajectories, which are on the evidence card already. */
function compact(ir: CapabilityIR): string {
  const { evidence, ...rest } = ir;
  return JSON.stringify({ ...rest, evidence: { ...evidence, trajectories: `${evidence.trajectories.length} trajectories, see Evidence` } }, null, 2);
}

/**
 * Stage 3: the capability specification, read as a document. The shape is ASIL's: a structured
 * observation, semantic actions with typed params, constraints, and a final-state validator. The
 * granularity decision shows the names rejected below and above the one chosen.
 */
export function SpecificationCard({ spec }: { spec: SpecRow | null }) {
  if (!spec) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>Capability specification</h2>
        </div>
        <p className="opp-quiet">The specification is compiled from the sessions once their intent is inferred.</p>
      </section>
    );
  }
  const { ir } = spec;
  const granularity = ir.granularity;
  const kinds = ir.success.scenarios.reduce<Record<string, number>>((acc, s) => {
    const kind = s.kind ?? "unspecified";
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Capability specification</h2>
        <span className="count-pill">v{spec.version}</span>
      </div>
      <pre className="spec-signature">{signatureOf(ir)}</pre>
      {ir.summary ? <p className="trace-row__text">{ir.summary}</p> : null}

      {granularity ? (
        <div className="opp-facts">
          <div className="opp-fact">
            <span className="opp-fact__num">{granularity.replaces_atomic_steps_median ?? "-"}</span>
            <span className="opp-fact__label">Manual steps one call replaces</span>
            <span className="opp-fact__note">By median over the supporting sessions.</span>
          </div>
          <div className="opp-fact">
            <span className="opp-fact__num is-text">{(granularity.rejected_too_low ?? []).join(", ") || "-"}</span>
            <span className="opp-fact__label">Rejected as too small</span>
            <span className="opp-fact__note">A single gesture, not a goal.</span>
          </div>
          <div className="opp-fact">
            <span className="opp-fact__num is-text">{(granularity.rejected_too_high ?? []).join(", ") || "-"}</span>
            <span className="opp-fact__label">Rejected as too big</span>
            <span className="opp-fact__note">No single observed end state.</span>
          </div>
          <div className="opp-fact">
            <span className="opp-fact__num">{granularity.coverage !== undefined ? `${Math.round(granularity.coverage * 100)}%` : "-"}</span>
            <span className="opp-fact__label">Sessions explained</span>
          </div>
        </div>
      ) : null}

      <div className="opp-columns">
        <div>
          <p className="detail-section__title">Structured state</p>
          <table className="spec-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Read from</th>
              </tr>
            </thead>
            <tbody>
              {ir.observation.inputs.map((s) => (
                <tr key={`in-${s.name}`}>
                  <td>
                    <code>{s.name}</code>
                  </td>
                  <td>
                    {s.type}
                    {slot(s)}
                  </td>
                  <td>the caller</td>
                </tr>
              ))}
              {ir.observation.app_state.map((s) => (
                <tr key={`st-${s.name}`}>
                  <td>
                    <code>{s.name}</code>
                  </td>
                  <td>
                    {s.type}
                    {slot(s)}
                  </td>
                  <td>the product, at call time</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ir.observation.interactive_elements && ir.observation.interactive_elements.length > 0 ? (
            <>
              <p className="detail-section__title" style={{ marginTop: 14 }}>
                Interactive elements
              </p>
              <ul className="spec-list">
                {ir.observation.interactive_elements.map((element) => (
                  <li key={element.type}>
                    <code>{element.type}</code>
                    <span>
                      id <code>{element.id.name}</code>
                      {element.attributes && element.attributes.length > 0
                        ? `, ${element.attributes.map((a) => a.name).join(", ")}`
                        : ""}
                      {element.available_actions && element.available_actions.length > 0
                        ? ` - ${element.available_actions.join(", ")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div>
          <p className="detail-section__title">Semantic actions</p>
          <table className="spec-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Kind</th>
                <th>Params</th>
              </tr>
            </thead>
            <tbody>
              {ir.actions.map((action) => (
                <tr key={action.name}>
                  <td>
                    <code>{action.name}</code>
                    {action.description ? <div className="opp-fact__note">{action.description}</div> : null}
                  </td>
                  <td>
                    {action.kind}
                    {action.action_type ? ` / ${action.action_type}` : ""}
                    {action.target ? ` on ${action.target}` : ""}
                  </td>
                  <td>{action.params.map((p) => p.name).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="opp-columns" style={{ marginTop: 16 }}>
        <div>
          <p className="detail-section__title">Constraints</p>
          <ul className="spec-list">
            {ir.constraints.map((c) => (
              <li key={c.id}>
                <span>{c.statement}</span>
                {c.source ? <span className="spec-source">{c.source}</span> : null}
              </li>
            ))}
          </ul>
          {ir.preferences && ir.preferences.length > 0 ? (
            <>
              <p className="detail-section__title" style={{ marginTop: 14 }}>
                Preferences
              </p>
              <ul className="spec-list">
                {ir.preferences.map((p) => (
                  <li key={p.id}>
                    <span>{p.statement}</span>
                    <span className="spec-source">{p.direction}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          <p className="detail-section__title">Success: the final state</p>
          <ul className="spec-list">
            {ir.success.final_state.map((check) => (
              <li key={check.id}>{check.statement}</li>
            ))}
          </ul>
          <p className="detail-section__title" style={{ marginTop: 14 }}>
            {ir.success.scenarios.length} verification scenarios
          </p>
          <p className="opp-quiet">
            {Object.entries(kinds)
              .map(([kind, n]) => `${n} ${kind}`)
              .join(", ")}
            . The Capability Verifier runs every one against each candidate.
          </p>
          {ir.proposed_ui ? (
            <>
              <p className="detail-section__title" style={{ marginTop: 14 }}>
                Proposed interface
              </p>
              <p className="opp-quiet">
                <strong>{ir.proposed_ui.label ?? "-"}</strong>
                {ir.proposed_ui.affordance ? ` (${ir.proposed_ui.affordance.replace(/_/g, " ")})` : ""}
                {ir.proposed_ui.location ? ` in the ${ir.proposed_ui.location.replace(/_/g, " ")}` : ""}.
                {ir.proposed_ui.result_summary ? ` ${ir.proposed_ui.result_summary}` : ""}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <details className="spec-raw" style={{ marginTop: 16 }}>
        <summary>The specification as JSON</summary>
        <pre className="code-block">
          <code>{compact(ir)}</code>
        </pre>
      </details>
      <p className="opp-quiet" style={{ marginTop: 10 }}>
        Compiled by {spec.model ?? "the compiler"} and validated against the Capability IR schema before it was stored.
      </p>
    </section>
  );
}
