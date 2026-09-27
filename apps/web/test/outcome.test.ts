import { describe, expect, it } from "vitest";
import type { Step, Verdict } from "@lantern/shared";
import {
  deriveOutcome,
  isConversationOutcome,
  outcomeFromTurns,
  outcomeLabel,
  outcomeTone,
  reconcileOutcome,
} from "@/lib/agent/outcome";

const step: Step = { target: "a1", caption: "Open the account menu", advanceOn: "click" };

function verdict(outcome: Verdict["outcome"]): Verdict {
  return { outcome, confidence: 0.9, reasoning: "", feature: "dark mode" };
}

describe("deriveOutcome", () => {
  it("counts guidance on the page as solved", () => {
    expect(deriveOutcome({ steps: [step], verdict: verdict("answer") })).toBe("solved");
  });

  it("stays solved even when the checks only hedged, because the user was still shown the way", () => {
    expect(deriveOutcome({ steps: [step], verdict: verdict("hedge") })).toBe("solved");
  });

  it("calls a confirmed absence a missing feature", () => {
    expect(deriveOutcome({ steps: null, verdict: verdict("absent") })).toBe("missing_feature");
  });

  it("calls a hedge unresolved", () => {
    expect(deriveOutcome({ steps: null, verdict: verdict("hedge") })).toBe("unresolved");
  });

  it("calls an answer with no usable steps unresolved, because nothing was shown", () => {
    expect(deriveOutcome({ steps: [], verdict: verdict("answer") })).toBe("unresolved");
    expect(deriveOutcome({ steps: null, verdict: verdict("answer") })).toBe("unresolved");
  });
});

describe("reconcileOutcome", () => {
  it("lets the model call an unresolved conversation a product bug", () => {
    expect(reconcileOutcome("unresolved", "product_bug")).toBe("product_bug");
  });

  it("lets the model tell a broken feature apart from a missing one", () => {
    expect(reconcileOutcome("missing_feature", "product_bug")).toBe("product_bug");
  });

  it("reports a bug even when the agent found the user a way round it", () => {
    expect(reconcileOutcome("solved", "product_bug")).toBe("product_bug");
  });

  it("never lets the model take back guidance for any other reason", () => {
    expect(reconcileOutcome("solved", "unresolved")).toBe("solved");
    expect(reconcileOutcome("solved", "missing_feature")).toBe("solved");
  });

  it("keeps the derived outcome for every other suggestion", () => {
    expect(reconcileOutcome("missing_feature", "solved")).toBe("missing_feature");
    expect(reconcileOutcome("unresolved", "missing_feature")).toBe("unresolved");
    expect(reconcileOutcome("unresolved", null)).toBe("unresolved");
    expect(reconcileOutcome("unresolved", "nonsense")).toBe("unresolved");
  });
});

describe("outcome labels", () => {
  it("accepts only the four stored values", () => {
    expect(isConversationOutcome("solved")).toBe(true);
    expect(isConversationOutcome("product_bug")).toBe(true);
    expect(isConversationOutcome("missing_feature")).toBe(true);
    expect(isConversationOutcome("unresolved")).toBe(true);
    expect(isConversationOutcome("shipped")).toBe(false);
  });

  it("reads as plain English, and says so when a turn is still running", () => {
    expect(outcomeLabel("solved")).toBe("Solved");
    expect(outcomeLabel("missing_feature")).toBe("Missing feature");
    expect(outcomeLabel("product_bug")).toBe("Product bug");
    expect(outcomeTone("product_bug")).toBe("is-bad");
    expect(outcomeLabel(null)).toBe("In progress");
    expect(outcomeTone("solved")).toBe("is-good");
    expect(outcomeTone(null)).toBe("is-muted");
  });
});

describe("outcomeFromTurns", () => {
  const asked = { role: "user", steps: null, verdict: null };

  it("is null while the agent has not replied, which is the only in-progress state", () => {
    expect(outcomeFromTurns([])).toBe(null);
    expect(outcomeFromTurns([asked])).toBe(null);
  });

  it("reads guidance in the transcript as solved", () => {
    expect(
      outcomeFromTurns([asked, { role: "assistant", steps: [step], verdict: verdict("answer") }]),
    ).toBe("solved");
  });

  it("reads a confirmed absence as a missing feature", () => {
    expect(
      outcomeFromTurns([asked, { role: "assistant", steps: null, verdict: verdict("absent") }]),
    ).toBe("missing_feature");
  });

  it("reads anything else as unresolved, including a reply with no verdict stored", () => {
    expect(
      outcomeFromTurns([asked, { role: "assistant", steps: null, verdict: verdict("hedge") }]),
    ).toBe("unresolved");
    expect(outcomeFromTurns([asked, { role: "assistant", steps: null, verdict: null }])).toBe(
      "unresolved",
    );
  });

  it("judges the conversation by its last reply", () => {
    expect(
      outcomeFromTurns([
        asked,
        { role: "assistant", steps: null, verdict: verdict("hedge") },
        asked,
        { role: "assistant", steps: [step], verdict: verdict("answer") },
      ]),
    ).toBe("solved");
  });
});
