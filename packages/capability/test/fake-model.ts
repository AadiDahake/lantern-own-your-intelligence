/**
 * A `ModelClient` that answers every prompt from the rendered text it is given, with no network.
 *
 * It reads the same prose the real model reads, so a prompt that stopped carrying the facts
 * (a party size, a confirmation, a refusal) would break these answers too. Goal names come from
 * the shape of the steps, rewards from the completion markers, and the naming call from the
 * varied properties. Nothing here looks at the fixtures directly.
 */
import type { JsonSchema, ModelClient, ModelPrompt } from "../src/types";

type Block = { id: string; lines: string[] };

/** Split a batched user message into one block per `Session <id> (...)` heading. */
function blocks(user: string): Block[] {
  const out: Block[] = [];
  let current: Block | null = null;
  for (const raw of user.split("\n")) {
    const heading = /^Session (\S+) \(/.exec(raw);
    if (heading) {
      current = { id: heading[1] as string, lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(raw);
    }
  }
  return out;
}

type Facts = {
  helpOnly: boolean;
  party: number;
  selections: number;
  refusals: number;
  hovers: number;
  confirmed: boolean;
  together: boolean;
};

function facts(lines: string[]): Facts {
  const steps = lines.filter((l) => /^\s*\d+\. /.test(l));
  const party = Number(/party of (\d+)/.exec(steps.join("\n"))?.[1] ?? 0);
  return {
    helpOnly: steps.length > 0 && steps.every((l) => l.includes("read the help article")),
    party,
    selections: steps.filter((l) => l.includes("selected seat")).length,
    refusals: steps.filter((l) => l.includes("was refused seat")).length,
    hovers: steps.filter((l) => l.includes("hovered seat")).length,
    confirmed: steps.some((l) => l.includes("confirmed seats")),
    together: steps.some((l) => l.includes("confirmed seats") && l.includes("same row: true, contiguous: true")),
  };
}

function goalFor(f: Facts): { goal_sentence: string; goal_name: string; confidence: number } {
  if (f.helpOnly) return { goal_sentence: "Read up on the trip before travelling", goal_name: "read_help_articles", confidence: 0.8 };
  if (f.party >= 2 && f.selections >= 2) {
    return { goal_sentence: "Seat the traveling party together", goal_name: "seat_party_together", confidence: f.confirmed ? 0.92 : 0.6 };
  }
  if (f.party === 1 || f.selections === 1) return { goal_sentence: "Change one passenger's seat", goal_name: "change_one_seat", confidence: 0.85 };
  return { goal_sentence: "", goal_name: "no_coherent_goal", confidence: 0.1 };
}

function gradeFor(f: Facts): { completion: number; coherence: number; total: number; why: string } {
  let completion: number;
  let why: string;
  if (f.helpOnly) {
    completion = 3;
    why = "Read what they came for; nothing to confirm.";
  } else if (f.confirmed && (f.party <= 1 || f.together)) {
    completion = 5;
    why = "The final state shows the seats confirmed together.";
  } else if (f.confirmed) {
    completion = 2;
    why = "Confirmed seats, but not together.";
  } else if (f.selections > 0) {
    completion = 2;
    why = "Started assigning seats and left before confirming.";
  } else {
    completion = 1;
    why = "Only browsed the map.";
  }
  const backtracks = f.refusals + Math.max(0, f.selections - Math.max(1, f.party));
  let coherence = backtracks === 0 ? 5 : backtracks === 1 ? 4 : backtracks <= 3 ? 3 : 2;
  if (completion === 1) coherence = 2;
  if (f.helpOnly) coherence = 5;
  const total = completion >= 3 ? completion : Math.min(completion, coherence);
  if (backtracks >= 2 && completion === 5) why = `Wandered through ${backtracks} refusals or re-selections, then succeeded.`;
  return { completion, coherence, total, why };
}

function toolSpecFor(user: string): unknown {
  const goal = /\(([a-z][a-z0-9_]*)\)\.$/m.exec(user)?.[1] ?? "capability";
  const varied = (/Properties that varied across sessions: (.*)$/m.exec(user)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "none");
  const replaced = /Median manual steps replaced: ([\d.]+)\./.exec(user)?.[1] ?? "?";
  if (goal === "seat_party_together" && varied.includes("party_size") && varied.includes("seat")) {
    return {
      name: "seat_party_together",
      signature: "seat_party_together(flight_id, passengers)",
      description:
        "Find one group of adjacent free seats in a single row for every passenger in the party, rank the groups by cost and restrictions, and move the whole party in one confirmed step.",
      arguments: [
        { name: "flight_id", type: "string", description: "The flight whose seat map to search." },
        { name: "passengers", type: "object[]", description: "The passengers to seat, in reservation order, each with an index and whether they are an adult or a child." },
      ],
      granularity_rationale: `One call replaces a median of ${replaced} manual steps and ends in the confirmed state every session reached; a single click replaces one step and a whole-trip tool has no single end state.`,
      summary: "Customers travelling together hunt row by row for adjacent seats and assign each passenger by hand; one action should do it.",
      actions: [
        { name: "get_available_seats", kind: "read", action_type: "api_call", target: "seat", description: "Every seat on the flight with its state and price.", parameters: ["flight_id"] },
        { name: "get_passenger_restrictions", kind: "read", action_type: "api_call", target: "passenger", description: "Which rows each passenger may sit in.", parameters: ["passenger_index"] },
        { name: "rank_seat_groups", kind: "rank", action_type: "invoke_function", target: "seat_group", description: "Adjacent groups of the party's size, cheapest and least restricted first.", parameters: ["party_size"] },
        { name: "assign_seat", kind: "write", action_type: "api_call", target: "seat", description: "Move one passenger to one seat; fails when the seat is taken or restricted.", parameters: ["passenger_index", "seat"] },
      ],
      proposed_ui: {
        location: "seat_map_toolbar",
        label: "Find seats together",
        affordance: "toolbar_action",
        result_summary: "We found 3 seats together: 21A, 21B, 21C. Additional cost: $0. [Move everyone]",
      },
    };
  }
  const args = varied.slice(0, 2);
  return {
    name: goal,
    signature: `${goal}(${args.join(", ")})`,
    description: `Do what the sessions did in one step: ${goal.replace(/_/g, " ")}.`,
    arguments: args.map((name) => ({ name, type: "string", description: `Observed to vary: ${name}.` })),
    granularity_rationale: `Replaces a median of ${replaced} manual steps and ends in one observed state.`,
    summary: `Users repeatedly ${goal.replace(/_/g, " ")} by hand.`,
    actions: [
      { name: "read_state", kind: "read", action_type: "api_call", target: "page", description: "Read the page state.", parameters: args.slice(0, 1) },
      { name: "commit", kind: "write", action_type: "api_call", target: "page", description: "Commit the outcome.", parameters: args },
    ],
    proposed_ui: { location: "page_toolbar", label: goal.replace(/_/g, " "), affordance: "button", result_summary: "Done." },
  };
}

export class FakeModelClient implements ModelClient {
  readonly name = "fake";
  readonly calls: ModelPrompt[] = [];

  async structured(prompt: ModelPrompt, _schema: JsonSchema): Promise<unknown> {
    this.calls.push(prompt);
    switch (prompt.purpose) {
      case "f_high":
        return { sessions: blocks(prompt.user).map((b) => ({ session_id: b.id, ...goalFor(facts(b.lines)) })) };
      case "trm":
        return { grades: blocks(prompt.user).map((b) => ({ session_id: b.id, ...gradeFor(facts(b.lines)) })) };
      case "tool_synth":
        return toolSpecFor(prompt.user);
    }
  }
}
