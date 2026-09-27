import { describe, expect, it } from "vitest";
import { DOCS_SURE_MISS, docsScore, overlapOf, probeCapabilities, probeInterface } from "@/lib/agent/probes";
import type { CapabilityEvidence } from "@/lib/agent/probes";
import { DEFAULT_THRESHOLDS } from "@lantern/shared";
import { NOVAAIR_GRAPH, NOVAAIR_GRAPH_AFTER } from "../../../packages/shared/test/fixtures/novaair-graph";

describe("the documentation score", () => {
  it("keeps a passage that uses the question's words and damps one that does not", () => {
    expect(docsScore(0.6, 1)).toBeCloseTo(0.6, 5);
    expect(docsScore(0.6, 0)).toBeCloseTo(0.36, 5);
    expect(docsScore(0.6, 0.5)).toBeGreaterThan(docsScore(0.6, 0.25));
  });

  it("measures overlap on concepts, so inflections and stopwords do not count against a passage", () => {
    expect(overlapOf("Where do I change my seat?", "Changing seats is done under Manage Trip.")).toBe(1);
    expect(overlapOf("Where do I add a checked bag?", "Seat selection fees")).toBe(0);
  });

  it("leaves a band to read between a sure miss and a sure hit", () => {
    expect(DOCS_SURE_MISS).toBeLessThan(DEFAULT_THRESHOLDS.docsThreshold);
  });
});

describe("the interface check", () => {
  it("does not count a link into the help pages as the control that does the thing", () => {
    const page = {
      url: "http://localhost:4150/",
      title: "NovaAir",
      affordances: [
        { id: "a1", role: "link", name: "Change my seat", href: "/help/how-do-i-change-my-seat", visible: true },
        { id: "a2", role: "link", name: "Change seats", href: "/trips/NVA7K2/seats", visible: true },
      ],
    };
    const result = probeInterface("Where do I change my seat?", page, "changing a seat");
    expect(result.hit).toBe(true);
    const top = (result.evidence as { id: string; score: number }[])[0];
    expect(top?.id).toBe("a2");
    const helpOnly = probeInterface("Where do I change my seat?", { ...page, affordances: [page.affordances[0]!] }, "changing a seat");
    expect(helpOnly.hit).toBe(false);
  });
});

/** The seat map, as the widget scans it: the controls a seat question matches on one word. */
const seatMap = {
  url: "http://localhost:4150/trips/NVA7K2/seats",
  title: "Choose Seats | NovaAir",
  affordances: [
    { id: "a1", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
    { id: "a2", role: "button", name: "Seat 1D, available, 45 dollars", landmark: "main", visible: true },
    { id: "a3", role: "button", name: "Confirm seats", landmark: "main", visible: true },
    { id: "a4", role: "link", name: "Find a flight", landmark: "sidebar", href: "/flights", visible: true },
  ],
};

describe("the capabilities check", () => {
  it("finds the control that does the thing and scores its coverage", async () => {
    const result = await probeCapabilities("p1", "changing a seat", NOVAAIR_GRAPH, null, "main");
    expect(result.hit).toBe(true);
    expect(result.score).toBe(1);
    expect(result.summary).toContain('"Change seats"');
  });

  it("refuses a control the page title lifted, however well it ranks", async () => {
    // "Find a flight" on the article titled "How do I change my seat?" outranks every other
    // control for this capability. It covers a third of it, so it is not a control for it, and
    // the check leaves no score behind for the router to read as one.
    const result = await probeCapabilities("p1", "finding seats together", NOVAAIR_GRAPH, null, "main");
    expect(result.hit).toBe(false);
    expect(result.score).toBeNull();
    expect(result.summary).toContain("No control for this on the site");
    const evidence = result.evidence as CapabilityEvidence;
    expect(evidence.graph.matches[0]?.score).toBeGreaterThan(0.5);
    expect(evidence.graph.matches.every((match) => match.coverage <= 1 / 3)).toBe(true);
  });

  it("finds the control on the day the product grows one, whichever verb the question used", async () => {
    for (const capability of ["finding seats together", "getting seats together"]) {
      const result = await probeCapabilities("p1", capability, NOVAAIR_GRAPH_AFTER, null, "main");
      expect(result.hit).toBe(true);
      expect(result.summary).toContain('"Find seats together"');
    }
  });

  it("says what it searched, so an absence is grounded in the product", async () => {
    const result = await probeCapabilities("p1", "finding seats together", NOVAAIR_GRAPH, null, "main");
    expect(result.summary).toContain(`${NOVAAIR_GRAPH.pages.length} pages`);
    expect(result.summary).toContain(`${NOVAAIR_GRAPH.controls.length} controls`);
  });
});

describe("the interface check on a seat map", () => {
  it("counts no seat button as a way of finding seats together", () => {
    const result = probeInterface(
      "I'm traveling with my two kids. Can you find us three seats together?",
      seatMap,
      "finding seats together",
    );
    expect(result.hit).toBe(false);
    expect(result.score).toBeLessThan(2 / 3);
  });

  /**
   * The one rule is the control's own name against the capability, and nothing else. A longer
   * name says the same thing with more words, and used to score below the line for it.
   */
  it("hits on a longer name that still says what the capability is", () => {
    const built = {
      ...seatMap,
      affordances: [
        ...seatMap.affordances,
        { id: "a8", role: "button", name: "Find three seats together", landmark: "sidebar", visible: true },
      ],
    };
    for (const capability of ["finding seats together", "getting seats together"]) {
      const result = probeInterface("How do I get seats together now?", built, capability);
      expect(result.hit).toBe(true);
      expect((result.evidence as { id: string }[])[0]?.id).toBe("a8");
    }
  });

  it("hits on the accessible name of the control once the seat map has one", () => {
    const built = {
      ...seatMap,
      affordances: [
        ...seatMap.affordances,
        { id: "a7", role: "button", name: "Find seats together", landmark: "main", visible: true },
      ],
    };
    for (const capability of ["finding seats together", "getting seats together"]) {
      const result = probeInterface("Okay, how do I get seats together now?", built, capability);
      expect(result.hit).toBe(true);
      expect((result.evidence as { id: string }[])[0]?.id).toBe("a7");
    }
  });
});
