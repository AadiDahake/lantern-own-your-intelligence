/**
 * `success.scenarios`: the test cases the Capability Verifier runs, derived from what the data
 * showed. Every rule names the fact it needs: a constraint the trajectories established, a refusal
 * the product made, a party size that was observed, a preference the users revealed, or nothing
 * (the cases every write capability must survive). A rule whose fact is absent emits nothing, so
 * the count is a property of the evidence, not a constant.
 */
import { VOCABULARY as V } from "./contract";
import type { Constraint, Preference, Scenario } from "./types";

export type ScenarioFacts = {
  intent: string;
  /** Distinct observed group sizes, ascending. Empty when the data has no group. */
  sizes: number[];
  /** The most common group size. */
  modal: number;
  /** Distinct refusal reasons the product recorded. */
  refusals: string[];
  constraints: Constraint[];
  preferences: Preference[];
};

type Rule = { when: (f: ScenarioFacts) => boolean; make: (f: ScenarioFacts) => Scenario[] };

const has = (f: ScenarioFacts, id: string): boolean => f.constraints.some((c) => c.id === id);
const refused = (f: ScenarioFacts, ...reasons: string[]): boolean => reasons.some((r) => f.refusals.includes(r));
const minimizes = (f: ScenarioFacts): boolean => f.preferences.some((p) => p.direction === "minimize");
const documented = (f: ScenarioFacts): Constraint[] =>
  f.constraints.filter((c) => c.source === "documentation" || c.source === "policy");

const one = (s: Scenario): Scenario[] => [s];

export const SCENARIO_RULES: Rule[] = [
  {
    when: () => true,
    make: (f) =>
      one({
        id: "contiguous_group_available",
        kind: "happy",
        given: `A ${V.group} of ${f.modal} and at least one group of ${f.modal} free ${V.units} side by side in one ${V.container}, on one side of the ${V.divider}`,
        when: `${f.intent} runs`,
        then: `It returns that group, moves every passenger into it, and reports the extra cost, which is zero for a free group`,
      }),
  },
  {
    when: (f) => f.sizes.some((n) => n < f.modal),
    make: (f) =>
      f.sizes
        .filter((n) => n < f.modal)
        .map((n) => ({
          id: `party_of_${n}`,
          kind: "happy" as const,
          given: `A ${V.group} of ${n}`,
          when: `${f.intent} runs`,
          then: `It finds a pair of adjacent free ${V.units} and never asks for more ${V.units} than the ${V.group} has passengers`,
        })),
  },
  {
    when: (f) => f.sizes.length > 0,
    make: (f) => {
      const largest = Math.max(...f.sizes);
      return one({
        id: `party_of_${largest + 1}`,
        kind: "edge",
        given: `A ${V.group} of ${largest + 1}, one more than the largest ${V.group} any session seated together`,
        when: `${f.intent} runs`,
        then: `It offers adjacent pairs in one ${V.container} when they exist, and otherwise reports that the ${V.group} cannot sit together; it never splits the ${V.group} silently`,
      });
    },
  },
  {
    when: (f) => has(f, "contiguous"),
    make: (f) =>
      one({
        id: "only_aisle_separated_seats",
        kind: "edge",
        given: `The only free combinations of ${f.modal} ${V.units} in any ${V.container} are split by the ${V.divider}, such as ${V.splitExample}`,
        when: `${f.intent} runs`,
        then: `No group is proposed and no ${V.unit} is assigned; the result says no group was found`,
      }),
  },
  {
    when: (f) => has(f, "contiguous"),
    make: (f) =>
      one({
        id: "aisle_boundary",
        kind: "edge",
        given: `One ${V.container} offers ${V.splitExample} across the ${V.divider} plus a neighbour, and another ${V.container} offers a true side-by-side group`,
        when: `${f.intent} ranks the groups`,
        then: `The side-by-side group wins; ${V.units} across the ${V.divider} are never treated as adjacent`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "no_group_available",
        kind: "edge",
        given: `No ${V.container} has ${f.modal} adjacent free ${V.units}`,
        when: `${f.intent} runs`,
        then: `It returns no group, assigns nothing, and the passengers keep their current ${V.units}`,
      }),
  },
  {
    when: (f) => refused(f, "blocked"),
    make: (f) =>
      one({
        id: "blocked_accessibility_seat",
        kind: "edge",
        given: `The only group that fits includes a ${V.unit} blocked for accessibility`,
        when: `${f.intent} runs`,
        then: `The blocked ${V.unit} is excluded and that group is rejected`,
      }),
  },
  {
    when: (f) => refused(f, "child_in_exit_row", "adults_only"),
    make: (f) =>
      one({
        id: "exit_row_restriction",
        kind: "edge",
        given: `The ${V.group} includes a child and the only free group is in an exit ${V.container}`,
        when: `${f.intent} runs`,
        then: `The exit ${V.container} is excluded for that ${V.group} and no child is placed in it`,
      }),
  },
  {
    when: (f) => refused(f, "booked"),
    make: (f) =>
      one({
        id: "seat_taken_during_checkout",
        kind: "concurrency",
        given: `A ${V.unit} in the chosen group is booked by another customer between ranking and assignment`,
        when: `${f.intent} assigns the group`,
        then: `The assignment fails as a whole, no passenger is left half-moved, and the caller is told to retry`,
      }),
  },
  {
    when: (f) => minimizes(f),
    make: (f) =>
      one({
        id: "existing_paid_seat",
        kind: "edge",
        given: `A passenger already holds a paid ${V.unit}`,
        when: `${f.intent} proposes a move`,
        then: `The result states the price difference before anyone is moved and never forfeits the paid ${V.unit} silently`,
      }),
  },
  {
    when: (f) => documented(f).length > 0,
    make: (f) =>
      documented(f).map((c) => ({
        id: `documented_${c.id}`,
        kind: "adversarial" as const,
        given: `A group satisfies every ${V.unit}-map rule but breaks a documented one: ${c.statement}`,
        when: `${f.intent} ranks the groups`,
        then: `That group is rejected, and the result says which rule it broke`,
      })),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "duplicate_submission",
        kind: "concurrency",
        given: `The same request is submitted twice within one second`,
        when: `${f.intent} handles the second call`,
        then: `It finds the ${V.group} already together and changes nothing; no ${V.unit} is assigned or charged twice`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "insufficient_permission",
        kind: "permission",
        given: `The caller is not the owner of the reservation`,
        when: `${f.intent} is called`,
        then: `The call is refused before any ${V.unit} is read or written`,
      }),
  },
  {
    when: (f) => minimizes(f),
    make: (f) =>
      one({
        id: "paid_row_ranking",
        kind: "edge",
        given: `Two groups fit: one in ${V.paidExample} and one that is free`,
        when: `${f.intent} ranks the groups`,
        then: `The free group is ranked first; the paid group is offered only when no free one exists`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "idempotent_rerun",
        kind: "edge",
        given: `${f.intent} has already moved the ${V.group} together`,
        when: `It runs again with the same inputs`,
        then: `The assignment is unchanged and the result reports the ${V.group} is already together`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "unknown_passenger",
        kind: "adversarial",
        given: `The ${V.group} lists a passenger who is not on the reservation`,
        when: `${f.intent} is called`,
        then: `The call is refused with a clear error and nothing is assigned`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "cancelled_reservation",
        kind: "adversarial",
        given: `The reservation was cancelled after the ${V.unit} map was loaded`,
        when: `${f.intent} is called`,
        then: `The call refuses to assign ${V.units} and says the reservation is not active`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "seat_map_changes_mid_selection",
        kind: "concurrency",
        given: `Availability changes between reading the ${V.unit} map and assigning`,
        when: `${f.intent} writes`,
        then: `It re-reads before writing or fails as a whole; it never assigns from a stale map`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "partial_failure_rolls_back",
        kind: "concurrency",
        given: `The second of ${f.modal} assignments fails`,
        when: `${f.intent} is moving the ${V.group}`,
        then: `The first assignment is reverted and the ${V.group} keeps its original ${V.units}`,
      }),
  },
  {
    when: () => true,
    make: (f) =>
      one({
        id: "already_together",
        kind: "happy",
        given: `The ${V.group} is already seated together`,
        when: `${f.intent} runs`,
        then: `The result says so and proposes no move`,
      }),
  },
  {
    when: (f) => has(f, "same_row"),
    make: (f) =>
      one({
        id: "party_larger_than_row",
        kind: "edge",
        given: `A ${V.group} larger than one side of a ${V.container}, for example seven in ${V.cabinExample}`,
        when: `${f.intent} runs`,
        then: `It reports that one ${V.container} cannot hold the ${V.group} rather than splitting it silently`,
      }),
  },
];

export function deriveScenarios(facts: ScenarioFacts): Scenario[] {
  const out: Scenario[] = [];
  const seen = new Set<string>();
  for (const rule of SCENARIO_RULES) {
    if (!rule.when(facts)) continue;
    for (const scenario of rule.make(facts)) {
      if (seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      out.push(scenario);
    }
  }
  return out;
}
