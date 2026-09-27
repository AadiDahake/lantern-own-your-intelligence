import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunnerReport, parseVerifierReport, scoreVerification } from "@/lib/forge/verify";
import { scenarioIds, parseCapabilityIr } from "@/lib/forge/ir";
import { fixture } from "./fake-strategy";

const IR = parseCapabilityIr(
  JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "forge", "fixtures", "seat-party-together.ir.json"), "utf8")),
);
const IDS = scenarioIds(IR);

describe("parseVerifierReport", () => {
  it("reads the verifier's structured report", () => {
    const { report, problem } = parseVerifierReport(fixture("candidate-a.verifier-report.json"));
    expect(problem).toBeNull();
    expect(report?.scenarios).toHaveLength(21);
    expect(report?.test_file).toBe("tests/seat-party-together.test.ts");
    expect(report?.scenarios.filter((scenario) => !scenario.passed).map((scenario) => scenario.id)).toEqual([
      "aisle_separated_not_adjacent",
      "blocked_accessibility_seat_excluded",
      "child_never_alone",
    ]);
  });

  it("finds the JSON object when the model wrapped it in prose", () => {
    const { report } = parseVerifierReport('Here is the report:\n{"scenarios":[{"id":"a","passed":true}],"summary":"ok"}\nDone.');
    expect(report?.scenarios).toEqual([{ id: "a", passed: true, test_name: "", notes: "" }]);
  });

  it("refuses anything that is not a report", () => {
    expect(parseVerifierReport("All tests pass!").report).toBeNull();
    expect(parseVerifierReport("All tests pass!").problem).toMatch(/JSON object/);
    expect(parseVerifierReport('{"summary":"x"}').problem).toMatch(/no scenarios/);
  });

  it("treats a scenario without passed: true as not passed", () => {
    const { report } = parseVerifierReport('{"scenarios":[{"id":"a","passed":"yes"},{"id":"b"}]}');
    expect(report?.scenarios.map((scenario) => scenario.passed)).toEqual([false, false]);
  });
});

describe("parseRunnerReport", () => {
  it("reads a vitest JSON report", () => {
    expect(parseRunnerReport(fixture("candidate-a.vitest.json"))).toEqual({ passed: 56, failed: 3, total: 59, success: false });
    expect(parseRunnerReport(fixture("candidate-b.vitest.json"))).toEqual({ passed: 59, failed: 0, total: 59, success: true });
  });

  it("returns null for output that is not a report", () => {
    expect(parseRunnerReport("Tests 3 passed")).toBeNull();
    expect(parseRunnerReport('{"numPassedTests":"many"}')).toBeNull();
  });
});

describe("scoreVerification", () => {
  it("counts the specification's scenarios, not the verifier's", () => {
    const a = scoreVerification(IDS, fixture("candidate-a.verifier-report.json"), fixture("candidate-a.vitest.json"));
    expect(a.scenariosPassed).toBe(18);
    expect(a.scenariosTotal).toBe(21);
    expect(a.failingScenarios).toEqual(["aisle_separated_not_adjacent", "blocked_accessibility_seat_excluded", "child_never_alone"]);
    expect(a.runner?.failed).toBe(3);
    expect(a.problem).toBeNull();

    const b = scoreVerification(IDS, fixture("candidate-b.verifier-report.json"), fixture("candidate-b.vitest.json"));
    expect(b.scenariosPassed).toBe(21);
    expect(b.failingScenarios).toEqual([]);
  });

  it("fails a scenario the verifier forgot and ignores one it invented", () => {
    const result = scoreVerification(
      ["one", "two", "three"],
      '{"scenarios":[{"id":"one","passed":true},{"id":"made_up","passed":true}],"summary":""}',
      null,
    );
    expect(result.scenariosPassed).toBe(1);
    expect(result.failingScenarios).toEqual(["two", "three"]);
    expect(result.runner).toBeNull();
  });

  it("scores zero with the reason when there is no report at all", () => {
    const result = scoreVerification(["one"], null, null);
    expect(result.scenariosPassed).toBe(0);
    expect(result.failingScenarios).toEqual(["one"]);
    expect(result.problem).toBe("the verifier wrote no report");
  });
});
