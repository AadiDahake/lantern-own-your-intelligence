import { describe, expect, it } from "vitest";
import { CapabilityIRError, assertCapabilityIR, validateCapabilityIR, type CapabilityIR } from "../src";

function minimal(): CapabilityIR {
  return {
    intent: "seat_party_together",
    observation: { inputs: [{ name: "flight_id", type: "string" }], app_state: [] },
    actions: [{ name: "assign_seat", kind: "write", params: [{ name: "seat", type: "string" }] }],
    constraints: [{ id: "same_row", statement: "The seats are in one row.", source: "trajectory" }],
    success: {
      final_state: [{ id: "together", statement: "Everyone is adjacent." }],
      scenarios: [{ id: "happy", given: "Three free seats", then: "They are assigned", kind: "happy" }],
    },
    evidence: { session_count: 1, trajectories: [{ session_id: "s1", steps: [{ t: "2026-08-01T10:00:00.000Z", event: "seat_selected" }] }] },
  };
}

describe("validateCapabilityIR", () => {
  it("accepts a minimal valid IR", () => {
    expect(validateCapabilityIR(minimal())).toEqual({ ok: true, value: minimal() });
  });

  it("refuses an IR with no constraints", () => {
    const empty = { ...minimal(), constraints: [] };
    const result = validateCapabilityIR(empty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(["/constraints must NOT have fewer than 1 items"]);

    const { constraints: _dropped, ...missing } = minimal();
    const gone = validateCapabilityIR(missing);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.errors).toEqual(["/ must have required property 'constraints'"]);
  });

  it("refuses an extra property at the root and inside a nested object", () => {
    const root = validateCapabilityIR({ ...minimal(), mcp: {} });
    expect(root.ok).toBe(false);
    if (!root.ok) expect(root.errors).toEqual(["/ must NOT have additional properties (mcp)"]);

    const nested = validateCapabilityIR({ ...minimal(), observation: { inputs: [], app_state: [], selector: "#seat" } });
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.errors).toEqual(["/observation must NOT have additional properties (selector)"]);
  });

  it("refuses a gesture-shaped intent, an out-of-range reward and a bad timestamp", () => {
    const gesture = validateCapabilityIR({ ...minimal(), intent: "clickSeat" });
    expect(gesture.ok).toBe(false);
    if (!gesture.ok) expect(gesture.errors[0]).toMatch(/^\/intent must match pattern/);

    const ir = minimal();
    ir.evidence.trajectories[0]!.reward = { completion: 5, coherence: 5, total: 6 };
    const reward = validateCapabilityIR(ir);
    expect(reward.ok).toBe(false);
    if (!reward.ok) expect(reward.errors).toEqual(["/evidence/trajectories/0/reward/total must be <= 5"]);

    const when = validateCapabilityIR({ ...minimal(), evidence: { ...minimal().evidence, window: { from: "yesterday" } } });
    expect(when.ok).toBe(false);
    if (!when.ok) expect(when.errors).toEqual(['/evidence/window/from must match format "date-time"']);
  });

  it("throws a typed error from assertCapabilityIR", () => {
    expect(() => assertCapabilityIR({})).toThrow(CapabilityIRError);
    try {
      assertCapabilityIR({});
    } catch (error) {
      expect((error as CapabilityIRError).errors.length).toBeGreaterThanOrEqual(6);
    }
  });
});
