import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CapabilityIRError,
  NOVAAIR_CONTEXT,
  compile,
  validateCapabilityIR,
  STAGE_ORDER,
  type CompileResult,
  type CompilerEvent,
  type ModelClient,
  type ModelPrompt,
} from "../src";
import { FakeModelClient } from "./fake-model";
import { FIXTURES, loadFixtures, unrelated } from "./helpers";
import { generate } from "../scripts/make-fixtures.mjs";

const rows = loadFixtures();
const fixed = () => new Date("2026-08-29T12:00:00.000Z");

let cached: Promise<CompileResult> | null = null;
const compiled = (): Promise<CompileResult> => (cached ??= compile(rows, NOVAAIR_CONTEXT, new FakeModelClient(), { now: fixed }));

describe("compile on the NovaAir fixtures", () => {
  it("yields seat_party_together with 63 sessions, a median of 14 manual actions and 21 scenarios", async () => {
    const result = await compiled();
    expect(result.decision).toBe("capability");
    if (result.decision !== "capability") return;
    const ir = result.ir;
    expect(ir.intent).toBe("seat_party_together");
    expect(ir.evidence.session_count).toBe(63);
    expect(ir.evidence.trajectories).toHaveLength(63);
    expect(ir.evidence.median_manual_actions).toBe(14);
    expect(ir.success.scenarios).toHaveLength(21);
    expect(validateCapabilityIR(ir).ok).toBe(true);
  });

  it("carries the constraints from the trajectories and the documentation, with their sources", async () => {
    const result = await compiled();
    if (result.decision !== "capability") throw new Error("expected a capability");
    const byId = new Map(result.ir.constraints.map((c) => [c.id, c]));
    expect([...byId.keys()]).toEqual(["contiguous", "same_row", "never_booked", "never_blocked", "never_child_in_exit_row", "child_with_adult"]);
    expect(byId.get("same_row")).toMatchObject({ source: "trajectory", evidence_ref: "seat_assignment_confirmed.same_row = true in 63/63 sessions" });
    expect(byId.get("never_booked")?.source).toBe("trajectory");
    expect(byId.get("child_with_adult")?.source).toBe("documentation");
    expect(result.ir.preferences?.map((p) => p.id)).toEqual(["minimize_additional_cost", "keep_children_adjacent_to_parent"]);
    expect(result.ir.success.final_state.map((p) => p.id)).toEqual(["outcome_committed", "seats_match_party_size", "result_contiguous", "result_same_row"]);
  });

  it("records the granularity decision and the provenance", async () => {
    const result = await compiled();
    if (result.decision !== "capability") throw new Error("expected a capability");
    expect(result.ir.granularity?.replaces_atomic_steps_median).toBe(14);
    expect(result.ir.granularity?.rejected_too_low).toContain("click_seat");
    expect(result.ir.granularity?.rejected_too_high).toEqual(["manage_trip"]);
    expect(result.ir.granularity?.coverage).toBeGreaterThan(0.9);
    expect(result.ir.provenance).toEqual({ compiler_version: "0.1.0", model: "fake", created_at: "2026-08-29T12:00:00.000Z" });
    expect(result.ir.observation.inputs.map((s) => s.name)).toEqual(["flight_id", "passengers"]);
    expect(result.ir.observation.app_state.map((s) => s.name)).toContain("state");
    expect(result.ir.observation.app_state.map((s) => s.name)).not.toContain("seats");
    expect(result.ir.actions.map((a) => `${a.kind}:${a.name}:${a.action_type}:${a.target}`)).toEqual([
      "read:get_available_seats:api_call:seat",
      "read:get_passenger_restrictions:api_call:passenger",
      "rank:rank_seat_groups:invoke_function:seat_group",
      "write:assign_seat:api_call:seat",
    ]);
    expect(result.ir.actions[3]?.params.map((p) => `${p.name}:${p.type}`)).toEqual(["passenger_index:integer", "seat:string"]);
    expect(result.ir.proposed_ui?.label).toBe("Find seats together");
  });

  it("describes the interactive elements the actions address, in ASIL's terms", async () => {
    const result = await compiled();
    if (result.decision !== "capability") throw new Error("expected a capability");
    const elements = result.ir.observation.interactive_elements ?? [];
    expect(elements.map((e) => e.type)).toEqual(["passenger", "seat"]);
    const seat = elements.find((e) => e.type === "seat");
    expect(seat?.id).toMatchObject({ name: "seat", type: "string", required: true });
    expect(seat?.attributes?.map((a) => a.name)).toEqual(["column", "price", "row", "state"]);
    expect(seat?.attributes?.find((a) => a.name === "state")?.enum).toEqual(["available", "blocked", "booked", "restricted"]);
    expect(seat?.constraints).toEqual(["never a seat that is blocked for accessibility", "never a seat that is already booked", "never a child in an exit row"]);
    expect(seat?.available_actions).toEqual(["assign_seat"]);
    const passenger = elements.find((e) => e.type === "passenger");
    expect(passenger?.id.name).toBe("passenger_index");
    expect(passenger?.attributes?.map((a) => a.name)).toEqual(["passenger_type"]);
    expect(passenger?.available_actions).toEqual(["get_passenger_restrictions", "assign_seat"]);
  });

  it("keeps completion and coherence separate in the evidence", async () => {
    const result = await compiled();
    if (result.decision !== "capability") throw new Error("expected a capability");
    const rewards = result.ir.evidence.trajectories.map((t) => t.reward);
    const wandered = rewards.filter((r) => r?.completion === 5 && (r.coherence ?? 5) <= 3);
    expect(wandered.length).toBeGreaterThan(5);
    for (const r of wandered) expect(r?.total).toBe(5);
    expect(result.ir.evidence.trajectories[0]?.reward?.total).toBe(5);
  });

  it("records the trail in the story's order: workflows, intent, capability, verification", async () => {
    const seen: CompilerEvent[] = [];
    const result = await compile(rows, NOVAAIR_CONTEXT, new FakeModelClient(), { now: fixed, onEvent: (e) => seen.push(e) });
    expect(seen).toEqual(result.events);
    const order = [...new Set(result.events.map((e) => e.stage))];
    expect(order).toEqual(STAGE_ORDER);
    for (const e of result.events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(typeof e.detail).toBe("object");
      expect(e.at).toBe("2026-08-29T12:00:00.000Z");
    }
    const titles = result.events.map((e) => e.title);
    expect(titles[0]).toBe("83 user workflows, 1255 steps");
    expect(titles).toContain("Inferred intent: Seat the traveling party together (68 sessions)");
    expect(titles).toContain("Scored 83 workflows, 77 kept (total >= 2), 6 dropped");
    expect(titles).toContain("Chosen: seat_party_together at level 2, replaces 14 steps, 95% support");
    expect(titles).toContain("Named: seat_party_together(flight_id, passengers)");
    expect(titles).toContain("21 scenarios, 4 final-state checks");
    expect(titles[titles.length - 1]).toBe("Capability seat_party_together: 63 workflows, 21 verification scenarios");
    const chosen = result.events.find((e) => e.title.startsWith("Chosen:"));
    expect(chosen?.detail.rejected_too_low).toContain("click_seat");
    expect(chosen?.detail.rejected_too_high).toEqual(["manage_trip"]);
  });

  it("returns none, with reasons, for the unrelated sessions", async () => {
    const result = await compile(unrelated(rows), NOVAAIR_CONTEXT, new FakeModelClient(), { now: fixed });
    expect(result.decision).toBe("none");
    if (result.decision !== "none") return;
    expect(result.reasons.join("\n")).toMatch(/the floor is 5/);
    expect(result.reasons.join("\n")).toMatch(/the floor is 3/);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.events[result.events.length - 1]).toMatchObject({ stage: "capability", title: "No capability warranted" });
  });

  it("never returns an invalid IR", async () => {
    const fake = new FakeModelClient();
    const noActions: ModelClient = {
      name: "no-actions",
      structured: async (prompt: ModelPrompt, schema) => {
        const out = (await fake.structured(prompt, schema)) as Record<string, unknown>;
        return prompt.purpose === "tool_synth" ? { ...out, actions: [] } : out;
      },
    };
    await expect(compile(rows, NOVAAIR_CONTEXT, noActions, { now: fixed })).rejects.toBeInstanceOf(CapabilityIRError);
  });
});

describe("the fixtures", () => {
  it("are reproducible from the seeded generator", () => {
    const checkedIn = JSON.parse(readFileSync(FIXTURES, "utf8"));
    expect(generate()).toEqual(checkedIn);
  });

  it("hold 63 successful family sessions, 15 to set aside and 5 unrelated ones", () => {
    expect(rows).toHaveLength(83);
    expect(unrelated(rows)).toHaveLength(5);
  });
});
