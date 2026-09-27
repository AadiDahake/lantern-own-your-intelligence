/**
 * Assembling the Capability IR from the winning candidate, the naming call and the evidence.
 *
 * The shape is ASIL's (arXiv 2608.26991): a structured observation with app state and interactive
 * elements, semantic actions with an action type, a target and typed params, and a final-state
 * validator. VACP (arXiv 2603.29322) and CI4A (arXiv 2601.14790) are the related work behind the
 * typed slots with ranges and enums, and the constraints with a source. Constraints, preferences
 * and elements are read off the data here; the naming model supplies the words, never the rules.
 */
import { gloss, glossReason, specFor } from "./contract";
import type { Candidate, Segment, ToolSpec } from "./granularity";
import { exemplarsOf } from "./granularity";
import { median } from "./random";
import { countManualActions } from "./render";
import type { InferredTask } from "./reverse-task-synthesis";
import { deriveScenarios, type ScenarioFacts } from "./scenarios";
import type {
  CapabilityAction,
  CompileContext,
  Constraint,
  EvidenceTrajectory,
  FinalStateCheck,
  InteractiveElement,
  Preference,
  RejectedCandidate,
  Slot,
  SlotType,
  TrajectoryStep,
} from "./types";

const NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const toId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "");

function stepsByRole(candidate: Candidate, role: "start" | "action" | "end"): TrajectoryStep[] {
  return candidate.segments.flatMap((s) => s.steps.filter((st) => specFor(st.event).role === role));
}

/** The committing steps of one session, so counts are per session even when a session committed twice. */
function endsBySession(candidate: Candidate): Map<string, TrajectoryStep[]> {
  const out = new Map<string, TrajectoryStep[]>();
  for (const seg of candidate.segments) {
    const ends = seg.steps.filter((st) => specFor(st.event).role === "end");
    if (ends.length === 0) continue;
    out.set(seg.session_id, [...(out.get(seg.session_id) ?? []), ...ends]);
  }
  return out;
}

/** Boolean properties on the committing step that were true in every session. */
export function outcomeInvariants(candidate: Candidate): Array<{ key: string; event: string; count: number }> {
  const sessions = [...endsBySession(candidate).values()];
  if (sessions.length === 0) return [];
  const keys = new Set(sessions.flat().flatMap((s) => Object.keys(s.props)));
  const out: Array<{ key: string; event: string; count: number }> = [];
  for (const key of keys) {
    if (!NAME.test(key)) continue;
    if (sessions.every((ends) => ends.every((s) => s.props[key] === true))) {
      out.push({ key, event: (sessions[0] as TrajectoryStep[])[0]?.event ?? "", count: sessions.length });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Refusal reasons the product recorded inside the candidate's segments, with counts. */
export function refusals(candidate: Candidate): Array<{ reason: string; event: string; prop: string; count: number }> {
  const counts = new Map<string, { reason: string; event: string; prop: string; count: number }>();
  for (const seg of candidate.segments) {
    for (const step of seg.steps) {
      const spec = specFor(step.event);
      if (!spec.refusal) continue;
      const reason = step.props[spec.refusal];
      if (typeof reason !== "string") continue;
      const entry = counts.get(reason) ?? { reason, event: step.event, prop: spec.refusal, count: 0 };
      entry.count += 1;
      counts.set(reason, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function deriveConstraints(candidate: Candidate): Constraint[] {
  const out: Constraint[] = [];
  for (const inv of outcomeInvariants(candidate)) {
    out.push({
      id: toId(inv.key),
      statement: `${capitalize(gloss(inv.key))}. Every one of the ${inv.count} manual sessions ended this way.`,
      source: "trajectory",
      evidence_ref: `${inv.event}.${inv.key} = true in ${inv.count}/${inv.count} sessions`,
    });
  }
  for (const r of refusals(candidate)) {
    out.push({
      id: `never_${toId(r.reason)}`,
      statement: `Never propose ${glossReason(r.reason)}. The product refused it ${r.count} time${r.count === 1 ? "" : "s"} in these sessions.`,
      source: "trajectory",
      evidence_ref: `${r.event}.${r.prop} = ${r.reason} in ${r.count} steps`,
    });
  }
  return out;
}

/**
 * A numeric outcome the users kept at its minimum whenever they could is something to minimise:
 * they had the choice and took the cheapest one more often than not.
 */
export function derivePreferences(candidate: Candidate): Preference[] {
  const sessions = [...endsBySession(candidate).values()];
  const out: Preference[] = [];
  const keys = new Set(sessions.flat().flatMap((s) => Object.keys(s.props)));
  for (const key of [...keys].sort()) {
    if (!NAME.test(key)) continue;
    const perSession = sessions.map((ends) => ends.map((s) => s.props[key]));
    if (!perSession.every((vs) => vs.every((v) => typeof v === "number"))) continue;
    const values = perSession.flat() as number[];
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) continue;
    const atMin = perSession.filter((vs) => (vs as number[]).every((v) => v === min)).length;
    const share = atMin / sessions.length;
    if (share < 0.5) continue;
    out.push({
      id: `minimize_${toId(key)}`,
      statement: `Keep ${gloss(key)} as low as possible. Users accepted ${min} in ${atMin} of ${sessions.length} sessions.`,
      direction: "minimize",
      weight: Math.round(share * 100) / 100,
    });
  }
  return out;
}

/** An array outcome whose length always equals an integer read at the start: one result per member. */
export function coverageInvariant(candidate: Candidate): { array: string; count: string } | null {
  const pairs = candidate.segments
    .map((seg) => {
      const start = seg.steps.find((s) => specFor(s.event).role === "start");
      const end = [...seg.steps].reverse().find((s) => specFor(s.event).role === "end");
      return start && end ? { start, end } : null;
    })
    .filter((p): p is { start: TrajectoryStep; end: TrajectoryStep } => p !== null);
  if (pairs.length === 0) return null;
  const first = pairs[0] as { start: TrajectoryStep; end: TrajectoryStep };
  for (const array of Object.keys(first.end.props)) {
    if (!NAME.test(array) || !Array.isArray(first.end.props[array])) continue;
    for (const count of Object.keys(first.start.props)) {
      if (!NAME.test(count) || !Number.isInteger(first.start.props[count])) continue;
      const holds = pairs.every((p) => {
        const a = p.end.props[array];
        return Array.isArray(a) && a.length === p.start.props[count];
      });
      if (holds) return { array, count };
    }
  }
  return null;
}

/** The final-state validator: what must hold in the state the call leaves, never in the steps it took. */
export function deriveFinalState(candidate: Candidate): FinalStateCheck[] {
  const out: FinalStateCheck[] = [];
  const end = stepsByRole(candidate, "end")[0];
  if (end) {
    out.push({
      id: "outcome_committed",
      statement: `The call ends with ${end.event} recorded, carrying the same properties a manual confirmation carries.`,
    });
  }
  const coverage = coverageInvariant(candidate);
  if (coverage) {
    out.push({
      id: `${toId(coverage.array)}_match_${toId(coverage.count)}`,
      statement: `There is one entry in ${gloss(coverage.array)} for each of ${gloss(coverage.count)}; nobody is left out.`,
    });
  }
  for (const inv of outcomeInvariants(candidate)) {
    out.push({ id: `result_${toId(inv.key)}`, statement: `${capitalize(gloss(inv.key))} for the result of the call.` });
  }
  return out;
}

function slotFromObserved(name: string, type: SlotType, values: unknown[], description: string, required: boolean): Slot {
  const slot: Slot = { name, type, description, required };
  if ((type === "integer" || type === "number") && values.length > 0) {
    const nums = values.filter((v): v is number => typeof v === "number");
    slot.range = { min: Math.min(...nums), max: Math.max(...nums) };
  } else if (type === "string" && values.length > 0 && values.length <= 8) {
    slot.enum = [...values].sort();
  }
  return slot;
}

const ARG_TYPES: Record<ToolSpec["arguments"][number]["type"], SlotType> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  "object[]": "object[]",
  "string[]": "string[]",
};

export type Observation = {
  inputs: Slot[];
  app_state: Slot[];
  interactive_elements: InteractiveElement[];
  example: Record<string, unknown>;
};

/**
 * The ASIL observation for this capability: the caller's inputs, the application state read at
 * call time, and the interactive elements the actions address, each with a stable id, the typed
 * attributes seen on it, and the constraints the product enforced on it.
 */
export function deriveObservation(candidate: Candidate, spec: ToolSpec, actions: CapabilityAction[]): Observation {
  const inputs: Slot[] = spec.arguments.map((a) => {
    const observedType = candidate.slots.types[a.name];
    const values = candidate.slots.values[a.name] ?? [];
    const type = observedType ?? ARG_TYPES[a.type];
    return slotFromObserved(a.name, type, values, a.description, true);
  });
  const inputNames = new Set(inputs.map((s) => s.name));
  const seenBeforeEnd = new Set<string>();
  for (const seg of candidate.segments) {
    for (const step of seg.steps) {
      if (specFor(step.event).role === "end") continue;
      for (const key of Object.keys(step.props)) seenBeforeEnd.add(key);
    }
  }
  const observed = (name: string, required: boolean): Slot =>
    slotFromObserved(
      name,
      candidate.slots.types[name] as SlotType,
      candidate.slots.values[name] ?? [],
      `${capitalize(gloss(name))}, read from the product while the capability runs.`,
      required,
    );
  const app_state: Slot[] = candidate.slots.arguments
    .filter((name) => !inputNames.has(name) && seenBeforeEnd.has(name))
    .map((name) => observed(name, false));
  const exemplar = exemplarsOf(candidate, 1)[0];
  const start = exemplar?.steps.find((s) => specFor(s.event).role === "start");
  const example: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(start?.props ?? {})) if (NAME.test(k)) example[k] = v;
  return { inputs, app_state, interactive_elements: deriveElements(candidate, actions), example };
}

/** The elements the events addressed, grouped by the type the contract gives them. */
export function deriveElements(candidate: Candidate, actions: CapabilityAction[]): InteractiveElement[] {
  const ids = new Set<string>();
  for (const spec of candidate.segments.flatMap((seg) => seg.steps.map((st) => specFor(st.event)))) if (spec.element) ids.add(spec.element.id);
  const byType = new Map<string, { id: string; attributes: Set<string>; constraints: Set<string> }>();
  for (const seg of candidate.segments) {
    for (const step of seg.steps) {
      const spec = specFor(step.event);
      if (!spec.element) continue;
      const entry = byType.get(spec.element.type) ?? { id: spec.element.id, attributes: new Set<string>(), constraints: new Set<string>() };
      for (const key of Object.keys(step.props)) {
        if (key === spec.element.id || ids.has(key) || key === spec.refusal) continue;
        if (candidate.slots.arguments.includes(key)) entry.attributes.add(key);
      }
      const reason = spec.refusal ? step.props[spec.refusal] : undefined;
      if (typeof reason === "string") entry.constraints.add(reason);
      byType.set(spec.element.type, entry);
    }
  }
  const slot = (name: string, required: boolean): Slot =>
    slotFromObserved(name, candidate.slots.types[name] ?? "string", candidate.slots.values[name] ?? [], capitalize(gloss(name)), required);
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, entry]) => ({
      type,
      id: slot(entry.id, true),
      attributes: [...entry.attributes].sort().map((name) => slot(name, false)),
      constraints: [...entry.constraints].sort().map((reason) => `never ${glossReason(reason)}`),
      available_actions: actions.filter((a) => a.params.some((p) => p.name === entry.id)).map((a) => a.name),
    }));
}

export function deriveActions(candidate: Candidate, spec: ToolSpec): CapabilityAction[] {
  const argTypes = new Map(spec.arguments.map((a) => [a.name, ARG_TYPES[a.type]]));
  return spec.actions.map((a) => ({
    name: a.name,
    kind: a.kind,
    action_type: a.action_type,
    target: a.target,
    description: a.description,
    params: a.parameters.map((p) => ({
      name: p,
      type: candidate.slots.types[p] ?? argTypes.get(p) ?? "string",
      description: gloss(p) === p.replace(/_/g, " ") ? undefined : capitalize(gloss(p)),
      required: true,
    })),
    ...(a.kind === "write" ? {} : { idempotent: true }),
  }));
}

/** The facts the scenario rules read. */
export function scenarioFacts(intent: string, candidate: Candidate, constraints: Constraint[], preferences: Preference[]): ScenarioFacts {
  const coverage = coverageInvariant(candidate);
  const sizes: number[] = [];
  const counts = new Map<number, number>();
  if (coverage) {
    for (const s of stepsByRole(candidate, "start")) {
      const v = s.props[coverage.count];
      if (Number.isInteger(v)) counts.set(v as number, (counts.get(v as number) ?? 0) + 1);
    }
    sizes.push(...[...counts.keys()].sort((a, b) => a - b));
  }
  let modal = sizes[0] ?? 0;
  for (const [size, n] of counts) if (n > (counts.get(modal) ?? 0)) modal = size;
  return {
    intent,
    sizes,
    modal,
    refusals: refusals(candidate).map((r) => r.reason),
    constraints,
    preferences,
  };
}

export function evidenceFor(candidate: Candidate, tasks: InferredTask[]): {
  trajectories: EvidenceTrajectory[];
  median_manual_actions: number;
  window: { from: string; to: string };
} {
  const byId = new Map(tasks.map((t) => [t.trajectory.session_id, t]));
  const segmentsBySession = new Map<string, Segment[]>();
  for (const seg of candidate.segments) {
    const list = segmentsBySession.get(seg.session_id) ?? [];
    list.push(seg);
    segmentsBySession.set(seg.session_id, list);
  }
  const supporting = candidate.sessions
    .map((id) => byId.get(id))
    .filter((t): t is InferredTask => t !== undefined)
    .sort((a, b) => b.reward.total - a.reward.total || a.trajectory.session_id.localeCompare(b.trajectory.session_id));
  const trajectories: EvidenceTrajectory[] = supporting.map((t) => ({
    session_id: t.trajectory.session_id,
    ...(t.trajectory.replay_url ? { replay_url: t.trajectory.replay_url } : {}),
    reward: { completion: t.reward.completion, coherence: t.reward.coherence, total: t.reward.total },
    steps: t.trajectory.steps.map((s) => ({ t: s.t, event: s.event, props: s.props })),
  }));
  const manual = supporting.map((t) =>
    (segmentsBySession.get(t.trajectory.session_id) ?? []).reduce((sum, seg) => sum + countManualActions(seg.steps), 0),
  );
  const starts = supporting.map((t) => t.trajectory.opened_at);
  const ends = supporting.map((t) => t.trajectory.confirmed_at ?? t.trajectory.steps[t.trajectory.steps.length - 1]?.t ?? t.trajectory.opened_at);
  return {
    trajectories,
    median_manual_actions: median(manual),
    window: { from: [...starts].sort()[0] as string, to: [...ends].sort().reverse()[0] as string },
  };
}

export type AssembleInput = {
  context: CompileContext;
  candidate: Candidate;
  spec: ToolSpec;
  tasks: InferredTask[];
  rejected: RejectedCandidate[];
  model: string;
  compiler_version: string;
  created_at: string;
};

/** Everything the schema asks for, in schema order. Validation happens in `compile`. */
export function assembleIR(input: AssembleInput): Record<string, unknown> {
  const { candidate, spec, context } = input;
  const constraints = [...deriveConstraints(candidate), ...(context.constraints ?? [])];
  const preferences = [...derivePreferences(candidate), ...(context.preferences ?? [])];
  const actions = deriveActions(candidate, spec);
  const observation = deriveObservation(candidate, spec, actions);
  const evidence = evidenceFor(candidate, input.tasks);
  const facts = scenarioFacts(spec.name, candidate, constraints, preferences);
  const uniqueNames = (rs: RejectedCandidate[]): string[] => [...new Set(rs.map((r) => r.name))];
  return {
    schema_version: "1",
    intent: spec.name,
    summary: spec.summary,
    observation,
    actions,
    constraints,
    preferences,
    success: {
      final_state: deriveFinalState(candidate),
      scenarios: deriveScenarios(facts),
    },
    proposed_ui: spec.proposed_ui,
    evidence: {
      session_count: evidence.trajectories.length,
      median_manual_actions: evidence.median_manual_actions,
      window: evidence.window,
      trajectories: evidence.trajectories,
    },
    granularity: {
      replaces_atomic_steps_median: candidate.replaces,
      rejected_too_low: uniqueNames(input.rejected.filter((r) => r.level < candidate.level && r.goal === candidate.goal)),
      rejected_too_high: uniqueNames(input.rejected.filter((r) => r.level > candidate.level && r.goal === candidate.goal)),
      coverage: Math.round(candidate.support * 1000) / 1000,
    },
    provenance: {
      compiler_version: input.compiler_version,
      model: input.model,
      created_at: input.created_at,
      ...(context.opportunity_id ? { opportunity_id: context.opportunity_id } : {}),
    },
  };
}
