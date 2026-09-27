import { describe, expect, it } from "vitest";
import { concepts, coverageNeeded, coversCapability, keywordScore, stem, tokenize } from "../src/text";

describe("tokenize", () => {
  it("lowercases, drops stopwords and stems", () => {
    expect(tokenize("How do I change my settings?")).toEqual(["chang", "setting"]);
  });

  it("splits on punctuation and ignores single characters", () => {
    expect(tokenize("api-keys / v2")).toEqual(["api", "key", "v2"]);
  });
});

describe("concepts", () => {
  it("collapses a synonym group onto one concept", () => {
    expect([...concepts("dark mode")]).toEqual([stem("theme")]);
  });
});

describe("keywordScore", () => {
  it("matches a control through the synonym list", () => {
    expect(keywordScore("dark mode", "Appearance")).toBe(1);
  });

  it("scores a partial concept match", () => {
    expect(keywordScore("change username", "Profile")).toBe(0.5);
  });

  it("scores an unrelated control at zero", () => {
    expect(keywordScore("dark mode", "Billing")).toBe(0);
  });

  it("returns zero for empty input on either side", () => {
    expect(keywordScore("", "Profile")).toBe(0);
    expect(keywordScore("dark mode", "")).toBe(0);
  });
});

describe("stem inflections", () => {
  it("brings a verb and its inflections to one form", () => {
    const forms = ["change", "changes", "changed", "changing"].map((word) => stem(word));
    expect(new Set(forms).size).toBe(1);
    expect(stem("seats")).toBe(stem("seat"));
    expect(stem("booking")).toBe(stem("book"));
  });

  it("keeps short words whole", () => {
    expect(stem("bag")).toBe("bag");
    expect(stem("seat")).toBe("seat");
    expect(stem("name")).toBe("name");
  });
});

describe("what it takes to cover a capability", () => {
  it("asks for every concept of a short capability and all but one of a long one", () => {
    expect(coverageNeeded("changing a seat")).toBe(1);
    expect(coverageNeeded("dark mode")).toBe(1);
    expect(coverageNeeded("finding seats together")).toBeCloseTo(2 / 3, 5);
    expect(coverageNeeded("adding a checked bag to a booking")).toBe(0.75);
  });

  it("counts a control that does the thing and refuses one that shares a word with it", () => {
    expect(coversCapability("changing a seat", "Change seats")).toBe(true);
    expect(coversCapability("finding seats together", "Seat 1C, available, 45 dollars")).toBe(false);
    expect(coversCapability("finding seats together", "Find a flight")).toBe(false);
    expect(coversCapability("adding a checked bag", "Bags")).toBe(false);
  });

  it("lets the verb of the question differ from the verb on the control", () => {
    // The same button, and three ways the understanding step might name what the user wants.
    for (const capability of ["finding seats together", "getting seats together", "choosing seats together"]) {
      expect(coversCapability(capability, "Find seats together")).toBe(true);
    }
    // One word in common is still one word: a seat button is not a way of seating a party.
    expect(coversCapability("getting seats together", "Seat 21A, available, no extra cost")).toBe(false);
    expect(coversCapability("getting seats together", "Change seats")).toBe(false);
  });

  it("is the rule the interface and capabilities checks share, so they cannot disagree", () => {
    for (const label of ["Change seats", "Seat 21A, available", "Find my booking"]) {
      const covered = keywordScore("changing a seat", label) >= coverageNeeded("changing a seat");
      expect(coversCapability("changing a seat", label)).toBe(covered);
    }
  });
});
