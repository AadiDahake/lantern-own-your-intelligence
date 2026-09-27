import { describe, expect, it } from "vitest";
import { parseDetail } from "@/lib/agent/summary";

const QUESTION = "The export button throws an error every time I click it on the Billing page.";

describe("parseDetail", () => {
  it("reads the whole shape out of a well-formed answer", () => {
    const detail = parseDetail(
      {
        summary: "The user reported that exporting from Billing fails.",
        outcome: "product_bug",
        evidence: ["throws an error every time I click it"],
        next_steps: ["Reproduce the export failure on the Billing page."],
        resolution: "The agent could not find a working export and offered to report it.",
        close_reason: "reported to the developers",
      },
      QUESTION,
    );
    expect(detail.summary).toBe("The user reported that exporting from Billing fails.");
    expect(detail.outcome).toBe("product_bug");
    expect(detail.evidence).toEqual(["throws an error every time I click it"]);
    expect(detail.nextSteps).toHaveLength(1);
    expect(detail.closeReason).toBe("reported to the developers");
  });

  it("drops evidence the user never said, because it is shown as a quotation", () => {
    const detail = parseDetail(
      { evidence: ["the export button is broken", "throws an error"] },
      QUESTION,
    );
    expect(detail.evidence).toEqual(["throws an error"]);
  });

  it("matches a quote regardless of how the model cased it", () => {
    const detail = parseDetail({ evidence: ["The Export Button"] }, QUESTION);
    expect(detail.evidence).toEqual(["The Export Button"]);
  });

  it("strips the quotation marks a model likes to wrap a sentence in", () => {
    const detail = parseDetail({ summary: '"It failed."' }, QUESTION);
    expect(detail.summary).toBe("It failed.");
  });

  it("keeps at most three of each list and skips blanks", () => {
    const detail = parseDetail(
      { next_steps: ["One", "  ", "Two", "Three", "Four"] },
      QUESTION,
    );
    expect(detail.nextSteps).toEqual(["One", "Two", "Three"]);
  });

  it("survives an answer that is not the shape it promised", () => {
    const detail = parseDetail({ summary: 12, evidence: "a string", next_steps: null }, QUESTION);
    expect(detail).toEqual({
      summary: "",
      evidence: [],
      nextSteps: [],
      resolution: "",
      closeReason: "",
      outcome: null,
    });
  });

  it("survives nothing at all", () => {
    expect(parseDetail(null, QUESTION).summary).toBe("");
  });
});
