import { describe, expect, it } from "vitest";
import { priorityFor, warrantsPullRequest, REQUEST_MATCH_THRESHOLD } from "../src/requests";

describe("priorityFor", () => {
  it("starts every request at the bottom of the pile", () => {
    expect(priorityFor(1, 0)).toBe("low");
    expect(priorityFor(2, 0)).toBe("low");
  });

  it("raises a request one person asked for outright", () => {
    expect(priorityFor(1, 1)).toBe("medium");
  });

  it("raises a request the agent kept running into", () => {
    expect(priorityFor(3, 0)).toBe("medium");
    expect(priorityFor(4, 0)).toBe("medium");
  });

  it("puts two users, or five detections, at the top", () => {
    expect(priorityFor(2, 2)).toBe("high");
    expect(priorityFor(5, 0)).toBe("high");
    expect(priorityFor(9, 1)).toBe("high");
  });
});

describe("warrantsPullRequest", () => {
  it("drafts code only once a request has weight behind it", () => {
    expect(warrantsPullRequest("low")).toBe(false);
    expect(warrantsPullRequest("medium")).toBe(true);
    expect(warrantsPullRequest("high")).toBe(true);
  });
});

it("keeps the matching threshold strict enough to separate different gaps", () => {
  expect(REQUEST_MATCH_THRESHOLD).toBeGreaterThanOrEqual(0.8);
  expect(REQUEST_MATCH_THRESHOLD).toBeLessThan(1);
});
