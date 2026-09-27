import { describe, expect, it } from "vitest";
import { NOVAAIR_CONTEXT, deriveScenarios, type ScenarioFacts } from "../src";

const novaair: ScenarioFacts = {
  intent: "seat_party_together",
  sizes: [2, 3],
  modal: 3,
  refusals: ["booked", "blocked", "child_in_exit_row"],
  constraints: [
    { id: "contiguous", statement: "Side by side.", source: "trajectory" },
    { id: "same_row", statement: "One row.", source: "trajectory" },
    { id: "never_booked", statement: "No booked seat.", source: "trajectory" },
    ...(NOVAAIR_CONTEXT.constraints ?? []),
  ],
  preferences: [{ id: "minimize_additional_cost", statement: "Cheapest first.", direction: "minimize", weight: 0.9 }],
};

/** The ten cases the plan lists for the Capability Verifier, by scenario id. */
const PERSONA_3 = [
  "contiguous_group_available",
  "only_aisle_separated_seats",
  "no_group_available",
  "blocked_accessibility_seat",
  "exit_row_restriction",
  "seat_taken_during_checkout",
  "existing_paid_seat",
  "documented_child_with_adult",
  "duplicate_submission",
  "insufficient_permission",
];

const FURTHER = [
  "aisle_boundary",
  "paid_row_ranking",
  "party_of_2",
  "party_of_4",
  "idempotent_rerun",
  "unknown_passenger",
  "cancelled_reservation",
  "seat_map_changes_mid_selection",
  "partial_failure_rolls_back",
  "already_together",
  "party_larger_than_row",
];

describe("deriveScenarios", () => {
  it("derives the 21 NovaAir scenarios from the constraints and the observed facts", () => {
    const scenarios = deriveScenarios(novaair);
    expect(scenarios).toHaveLength(21);
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(21);
    for (const id of [...PERSONA_3, ...FURTHER]) expect(ids).toContain(id);
  });

  it("gives every scenario an id, a given, a when, a then and a kind", () => {
    for (const s of deriveScenarios(novaair)) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(s.given.length).toBeGreaterThan(10);
      expect(s.when?.length).toBeGreaterThan(5);
      expect(s.then.length).toBeGreaterThan(10);
      expect(["happy", "edge", "adversarial", "concurrency", "permission"]).toContain(s.kind);
    }
    const kinds = new Set(deriveScenarios(novaair).map((s) => s.kind));
    expect(kinds.size).toBe(5);
  });

  it("emits fewer cases when the evidence shows less", () => {
    const thin = deriveScenarios({ ...novaair, refusals: [], preferences: [], constraints: [], sizes: [3] });
    const ids = thin.map((s) => s.id);
    expect(ids).not.toContain("blocked_accessibility_seat");
    expect(ids).not.toContain("exit_row_restriction");
    expect(ids).not.toContain("seat_taken_during_checkout");
    expect(ids).not.toContain("paid_row_ranking");
    expect(ids).not.toContain("only_aisle_separated_seats");
    expect(ids).not.toContain("party_larger_than_row");
    expect(ids).not.toContain("party_of_2");
    expect(ids).toContain("party_of_4");
    expect(ids).toContain("duplicate_submission");
    expect(thin.length).toBeLessThan(21);
  });

  it("writes the party size it observed into the happy path", () => {
    const [first] = deriveScenarios({ ...novaair, sizes: [2], modal: 2 });
    expect(first?.given).toContain("A party of 2");
  });
});
