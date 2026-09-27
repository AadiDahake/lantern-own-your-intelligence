/**
 * The TypeScript type and the JSON Schema are written separately. These tests prove they agree:
 * a fully typed example validates, and every property the schema declares is a key the type has.
 */
import { describe, expect, it } from "vitest";
import schema from "../src/capability-ir.schema.json";
import { validateCapabilityIR } from "../src";
import type {
  CapabilityAction,
  CapabilityIR,
  Constraint,
  Evidence,
  EvidenceStep,
  EvidenceTrajectory,
  FinalStateCheck,
  Granularity,
  InteractiveElement,
  Preference,
  ProposedUi,
  Provenance,
  Reward,
  Scenario,
  Slot,
} from "../src";

const slot: Required<Slot> = {
  name: "party_size",
  type: "integer",
  description: "How many travel together",
  required: true,
  enum: [2, 3],
  range: { min: 2, max: 3 },
};

const action: Required<CapabilityAction> = {
  name: "assign_seat",
  kind: "write",
  action_type: "api_call",
  target: "seat",
  description: "Move one passenger",
  params: [slot],
  returns: "SeatAssignment",
  primitive: { symbol: "assignSeat", file: "lib/seats/assign.ts", confidence: 0.9 },
  idempotent: true,
};

const constraint: Required<Constraint> = { id: "same_row", statement: "One row.", source: "trajectory", evidence_ref: "x" };
const preference: Required<Preference> = { id: "minimize_cost", statement: "Cheapest first.", direction: "minimize", weight: 0.8 };
const check: Required<FinalStateCheck> = { id: "adjacent", statement: "All adjacent." };
const element: Required<InteractiveElement> = {
  type: "seat",
  id: slot,
  attributes: [slot],
  constraints: ["never a seat that is already booked"],
  available_actions: ["assign_seat"],
};
const scenario: Required<Scenario> = { id: "happy", given: "g", when: "w", then: "t", kind: "happy" };
const proposedUi: Required<ProposedUi> = { location: "seat_map_toolbar", label: "Find seats together", affordance: "toolbar_action", result_summary: "3 seats" };
const reward: Required<Reward> = { completion: 5, coherence: 2, total: 5 };
const step: Required<EvidenceStep> = { t: "2026-08-01T10:00:00.000Z", event: "seat_selected", props: { seat: "21A" } };
const trajectory: Required<EvidenceTrajectory> = {
  session_id: "s1",
  replay_url: "https://us.posthog.com/project/1/replay/s1",
  reward,
  steps: [step],
};
const evidence: Required<Evidence> = {
  session_count: 63,
  median_manual_actions: 14,
  window: { from: "2026-06-01T00:00:00.000Z", to: "2026-08-28T00:00:00.000Z" },
  trajectories: [trajectory],
};
const granularity: Required<Granularity> = { replaces_atomic_steps_median: 14, rejected_too_low: ["click_seat"], rejected_too_high: ["manage_trip"], coverage: 0.95 };
const provenance: Required<Provenance> = { compiler_version: "0.1.0", model: "fake", created_at: "2026-08-29T00:00:00.000Z", opportunity_id: "opp-1" };

/** Every field the type has, filled in. `Required` makes leaving one out a compile error. */
const full: Required<CapabilityIR> = {
  schema_version: "1",
  intent: "seat_party_together",
  summary: "Seat everyone together in one step.",
  observation: { inputs: [slot], app_state: [slot], interactive_elements: [element], example: { party_size: 3 } },
  actions: [action],
  constraints: [constraint],
  preferences: [preference],
  success: { final_state: [check], scenarios: [scenario] },
  proposed_ui: proposedUi,
  evidence,
  granularity,
  provenance,
};

type SchemaObject = { properties?: Record<string, unknown>; items?: SchemaObject; $defs?: Record<string, SchemaObject> };
const props = (node: SchemaObject | undefined): string[] => Object.keys(node?.properties ?? {}).sort();
const root = schema as unknown as SchemaObject & { properties: Record<string, SchemaObject> };

describe("the IR type matches the schema", () => {
  it("validates a fully typed example", () => {
    expect(validateCapabilityIR(full)).toEqual({ ok: true, value: full });
  });

  it("declares exactly the properties the schema declares, at every level", () => {
    expect(Object.keys(full).sort()).toEqual(props(root));
    expect(Object.keys(full.observation).sort()).toEqual(props(root.properties.observation));
    expect(Object.keys(element).sort()).toEqual(props(root.$defs?.element));
    expect(Object.keys(action).sort()).toEqual(props(root.properties.actions?.items));
    expect(Object.keys(constraint).sort()).toEqual(props(root.properties.constraints?.items));
    expect(Object.keys(preference).sort()).toEqual(props(root.properties.preferences?.items));
    expect(Object.keys(full.success).sort()).toEqual(props(root.properties.success));
    expect(Object.keys(check).sort()).toEqual(props((root.properties.success?.properties?.final_state as SchemaObject).items));
    expect(Object.keys(scenario).sort()).toEqual(props((root.properties.success?.properties?.scenarios as SchemaObject).items));
    expect(Object.keys(proposedUi).sort()).toEqual(props(root.properties.proposed_ui));
    expect(Object.keys(evidence).sort()).toEqual(props(root.properties.evidence));
    expect(Object.keys(trajectory).sort()).toEqual(props((root.properties.evidence?.properties?.trajectories as SchemaObject).items));
    expect(Object.keys(reward).sort()).toEqual(props(((root.properties.evidence?.properties?.trajectories as SchemaObject).items?.properties?.reward as SchemaObject)));
    expect(Object.keys(step).sort()).toEqual(props(((root.properties.evidence?.properties?.trajectories as SchemaObject).items?.properties?.steps as SchemaObject).items));
    expect(Object.keys(granularity).sort()).toEqual(props(root.properties.granularity));
    expect(Object.keys(provenance).sort()).toEqual(props(root.properties.provenance));
    expect(Object.keys(slot).sort()).toEqual(props(root.$defs?.slot));
  });

  it("pins the schema version to 1", () => {
    expect(root.properties.schema_version).toEqual({ const: "1" });
    expect(validateCapabilityIR({ ...full, schema_version: "2" }).ok).toBe(false);
  });
});
