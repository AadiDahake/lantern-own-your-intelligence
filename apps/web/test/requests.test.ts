import { describe, expect, it } from "vitest";
import type { RequestGroup } from "@lantern/shared";
import { actionFor } from "@/lib/agent/requests";

function group(over: Partial<RequestGroup> = {}): RequestGroup {
  return {
    id: "g1",
    title: "Add a dark mode toggle",
    description: "Users want a dark theme.",
    area: "settings",
    reportCount: 1,
    userReportCount: 0,
    priority: "low",
    status: "observed",
    issueUrl: null,
    issueNumber: null,
    prUrl: null,
    escalationId: null,
    firstSeen: "2026-08-20T10:00:00Z",
    lastSeen: "2026-08-20T10:00:00Z",
    ...over,
  };
}

describe("actionFor", () => {
  it("files the issue and nothing else when a request is first seen", () => {
    expect(actionFor(group(), true, true)).toBe("file_only");
  });

  it("records the demand but files nothing without a repository", () => {
    expect(actionFor(group(), true, false)).toBe("none");
    expect(actionFor(group({ priority: "high" }), false, false)).toBe("none");
  });

  it("only updates the count while a request stays at the bottom of the pile", () => {
    expect(actionFor(group({ status: "filed", reportCount: 2 }), false, true)).toBe("update");
  });

  it("drafts the change once a request has weight behind it", () => {
    const promoted = group({ status: "filed", priority: "medium", reportCount: 3 });
    expect(actionFor(promoted, false, true)).toBe("full");
  });

  it("never drafts a second change for a request already being worked on", () => {
    for (const status of ["drafting", "pr_open", "awaiting_approval", "shipped", "rejected"] as const) {
      expect(actionFor(group({ status, priority: "high" }), false, true)).toBe("update");
    }
  });

  it("never drafts a second change for a request that already has one open", () => {
    const open = group({
      status: "filed",
      priority: "high",
      prUrl: "https://github.com/acme/app/pull/13",
    });
    expect(actionFor(open, false, true)).toBe("update");
  });
});
