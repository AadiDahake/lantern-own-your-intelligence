import { describe, expect, it } from "vitest";
import { selectWinner, type ScoredCandidate } from "@/lib/forge/select";

function candidate(over: Partial<ScoredCandidate>): ScoredCandidate {
  return { id: over.label ?? "x", label: "A", status: "ready", scenariosPassed: 0, scenariosTotal: 21, changedFiles: 5, ...over };
}

describe("selectWinner", () => {
  it("picks the candidate that passed the most scenarios", () => {
    const selection = selectWinner([
      candidate({ label: "A", scenariosPassed: 18, changedFiles: 4 }),
      candidate({ label: "B", scenariosPassed: 21, changedFiles: 6 }),
    ]);
    expect(selection?.winner.label).toBe("B");
    expect(selection?.reason).toBe("21 of 21 scenarios passed, against 18 for candidate A");
  });

  it("breaks a tie on fewer changed files", () => {
    const selection = selectWinner([
      candidate({ label: "A", scenariosPassed: 21, changedFiles: 7 }),
      candidate({ label: "B", scenariosPassed: 21, changedFiles: 5 }),
    ]);
    expect(selection?.winner.label).toBe("B");
    expect(selection?.reason).toContain("tied with candidate A");
    expect(selection?.reason).toContain("fewer changed files (5 against 7)");
  });

  it("breaks a full tie on the label, so the choice is stable", () => {
    expect(selectWinner([candidate({ label: "B", scenariosPassed: 21 }), candidate({ label: "A", scenariosPassed: 21 })])?.winner.label).toBe("A");
  });

  it("ignores candidates that did not finish", () => {
    const selection = selectWinner([
      candidate({ label: "A", status: "failed", scenariosPassed: 21, changedFiles: 1 }),
      candidate({ label: "B", scenariosPassed: 18 }),
    ]);
    expect(selection?.winner.label).toBe("B");
    expect(selection?.reason).toBe("18 of 21 scenarios passed; the other candidate did not finish");
  });

  it("returns null when nobody finished", () => {
    expect(selectWinner([candidate({ status: "failed" }), candidate({ label: "B", status: "failed" })])).toBeNull();
    expect(selectWinner([])).toBeNull();
  });
});
