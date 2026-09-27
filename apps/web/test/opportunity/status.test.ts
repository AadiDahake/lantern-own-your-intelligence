import { describe, expect, it } from "vitest";
import { opportunityStatus, type StatusInput } from "@/lib/opportunity/status";

function input(over: Partial<StatusInput> = {}): StatusInput {
  return { discovery: null, hasSpec: false, escalation: null, candidates: [], hasOutcome: false, ...over };
}

describe("opportunityStatus", () => {
  it("follows the story in order", () => {
    expect(opportunityStatus(input({ discovery: { status: "queued", decision: null } }))).toBe("discovering");
    expect(opportunityStatus(input({ discovery: { status: "running", decision: null } }))).toBe("discovering");
    expect(opportunityStatus(input({ discovery: { status: "failed", decision: null } }))).toBe("failed");
    expect(opportunityStatus(input({ discovery: { status: "done", decision: "none" } }))).toBe("not_warranted");
    expect(opportunityStatus(input({ discovery: { status: "done", decision: "capability" }, hasSpec: true }))).toBe("discovered");
    expect(opportunityStatus(input({ hasSpec: true, escalation: { status: "drafting", prUrl: null, winningCandidateId: null } }))).toBe("building");
    expect(
      opportunityStatus(
        input({
          hasSpec: true,
          escalation: { status: "drafting", prUrl: null, winningCandidateId: "c2" },
          candidates: [{ status: "ready", scenariosPassed: 21 }],
        }),
      ),
    ).toBe("verified");
    expect(opportunityStatus(input({ hasSpec: true, escalation: { status: "awaiting_approval", prUrl: "https://x/pull/1", winningCandidateId: "c2" } }))).toBe("pr_open");
    expect(opportunityStatus(input({ hasSpec: true, escalation: { status: "shipped", prUrl: "https://x/pull/1", winningCandidateId: "c2" } }))).toBe("merged");
    expect(opportunityStatus(input({ hasSpec: true, escalation: { status: "shipped", prUrl: "https://x/pull/1", winningCandidateId: "c2" }, hasOutcome: true }))).toBe("measured");
  });

  it("keeps a later stage even when an earlier discovery failed", () => {
    expect(opportunityStatus(input({ discovery: { status: "failed", decision: null }, hasSpec: true }))).toBe("discovered");
  });

  it("does not read a failed forge run as a pull request", () => {
    expect(opportunityStatus(input({ hasSpec: true, escalation: { status: "failed", prUrl: null, winningCandidateId: null } }))).toBe("discovered");
  });
});
