import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCapabilityIr, type CapabilityIr } from "@/lib/forge/ir";
import { branchName, prBody, prTitle } from "@/lib/forge/pr";

const IR = parseCapabilityIr(
  JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "forge", "fixtures", "seat-party-together.ir.json"), "utf8")),
);

describe("prTitle", () => {
  it("turns the specification's summary into an imperative title", () => {
    expect(prTitle(IR)).toBe("Add automatic family seat selection");
  });

  it("keeps a summary that already reads as an instruction", () => {
    expect(prTitle({ ...IR, summary: "Let a customer download every receipt at once. Long explanation." })).toBe(
      "Let a customer download every receipt at once",
    );
  });

  it("falls back to the intent", () => {
    expect(prTitle({ ...IR, summary: undefined })).toBe("Add seat party together");
  });
});

describe("branchName", () => {
  it("names the branch after the intent and the candidate", () => {
    expect(branchName(IR, "B")).toBe("lantern/seat-party-together-b");
  });
});

describe("prBody", () => {
  const body = (over: Partial<Parameters<typeof prBody>[0]> = {}) =>
    prBody({
      ir: IR,
      candidateLabel: "B",
      verification: {
        scenariosPassed: 21,
        scenariosTotal: 21,
        failingScenarios: [],
        verifier: { scenarios: [], test_command: "npm test", test_file: "tests/seat-party-together.test.ts", summary: "" },
        runner: { passed: 59, failed: 0, total: 59, success: true },
        problem: null,
      },
      changedFiles: [
        { path: "components/seats/FindSeatsTogether.tsx", kind: "add" },
        { path: "lib/seats/together.ts", kind: "add" },
      ],
      previewUrl: "https://3000-abc.tunnel.runloop.ai",
      opportunityUrl: "http://localhost:3000/console/activity?escalation=e1",
      strategy: "runloop",
      ...over,
    });

  it("carries why, what, safety, validation, files, preview and the link back", () => {
    const text = body();
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(sections).toEqual(["Why", "What", "Safety", "Validation", "Changed files", "Preview", "Lantern"]);
    expect(text).toContain("PostHog found 63 successful sessions where customers did this by hand.");
    expect(text).toContain("The median session took 14.2 manual actions.");
    expect(text).toContain("21 / 21 sandbox scenarios passed (candidate B, runloop sandbox).");
    expect(text).toContain("Tests: `tests/seat-party-together.test.ts`.");
    expect(text).toContain("- `lib/seats/together.ts` (add)");
    expect(text).toContain("https://3000-abc.tunnel.runloop.ai");
    expect(text).toContain("A person approves it in the Lantern console before it merges.");
    expect(text).not.toContain("—");
  });

  it("lists the scenarios that did not pass, with the verifier's note", () => {
    const text = body({
      candidateLabel: "A",
      verification: {
        scenariosPassed: 18,
        scenariosTotal: 21,
        failingScenarios: ["child_never_alone"],
        verifier: { scenarios: [{ id: "child_never_alone", passed: false, test_name: "", notes: "the child sat beside a stranger" }], test_command: "", test_file: "", summary: "" },
        runner: null,
        problem: null,
      },
    });
    expect(text).toContain("18 / 21 sandbox scenarios passed");
    expect(text).toContain("- `child_never_alone`: the child sat beside a stranger");
    expect(text).not.toContain("repository's own test suite");
  });

  it("says when there is no preview and no opportunity link", () => {
    const text = body({ previewUrl: null, opportunityUrl: null });
    expect(text).toContain("No preview is running.");
    expect(text).not.toContain("Opportunity:");
  });

  it("uses the intent when the specification has no interface proposal", () => {
    const ir: CapabilityIr = { ...IR, proposed_ui: undefined };
    expect(body({ ir })).toContain('Adds "seat party together".');
  });
});
