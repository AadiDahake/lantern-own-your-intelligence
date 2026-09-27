import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCapabilityIR } from "@lantern/capability";
import { intentSlug, intentWords, parseCapabilityIr, scenarioIds } from "@/lib/forge/ir";

const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "forge", "fixtures", "seat-party-together.ir.json"), "utf8"));

describe("parseCapabilityIr", () => {
  it("accepts the NovaAir specification, which is valid against the compiler's schema", () => {
    expect(validateCapabilityIR(raw)).toMatchObject({ ok: true });
    const ir = parseCapabilityIr(raw);
    expect(ir.intent).toBe("seat_party_together");
    expect(scenarioIds(ir)).toHaveLength(21);
    expect(new Set(scenarioIds(ir)).size).toBe(21);
    expect(ir.evidence.session_count).toBe(63);
    expect(ir.evidence.median_manual_actions).toBe(14.2);
    expect(ir.actions.map((action) => action.name)).toContain("rank_seat_groups");
    expect(ir.success.final_state.map((check) => check.id)).toContain("all_passengers_adjacent");
    expect(intentSlug(ir)).toBe("seat-party-together");
    expect(intentWords(ir)).toBe("seat party together");
  });

  it("refuses an invalid specification and says where", () => {
    expect(() => parseCapabilityIr(null)).toThrow(/^Capability IR:/);
    expect(() => parseCapabilityIr({ ...raw, intent: "ClickSeat" })).toThrow(/\/intent must match pattern/);
    expect(() => parseCapabilityIr({ ...raw, actions: [] })).toThrow(/\/actions must NOT have fewer than 1 items/);
    expect(() => parseCapabilityIr({ ...raw, constraints: [{ id: "x" }] })).toThrow(/constraints\/0 must have required property 'statement'/);
    expect(() => parseCapabilityIr({ ...raw, success: { final_state: [], scenarios: raw.success.scenarios } })).toThrow(/final_state/);
    expect(() => parseCapabilityIr({ ...raw, evidence: { session_count: 0, trajectories: [] } })).toThrow(/session_count/);
    expect(() => parseCapabilityIr({ ...raw, state: { inputs: [] } })).toThrow(/must NOT have additional properties \(state\)/);
  });

  it("refuses duplicate scenario ids, because the count is the demo's denominator", () => {
    const twice = { ...raw, success: { ...raw.success, scenarios: [...raw.success.scenarios, raw.success.scenarios[0]] } };
    expect(() => parseCapabilityIr(twice)).toThrow("must be unique");
  });
});
