import { describe, expect, it } from "vitest";
import type { PageContext } from "@lantern/shared";
import {
  CONTROLS,
  NOVAAIR_GRAPH,
  NOVAAIR_GRAPH_AFTER,
  ROUTES,
} from "../../../packages/shared/test/fixtures/novaair-graph";
import { bindFirstStep, candidatesFor, planEndsOnCapability } from "@/lib/agent/resolve";
import type { DocsEvidence } from "@/lib/agent/probes";

const home: PageContext = {
  url: "http://localhost:4150/",
  title: "NovaAir",
  affordances: [
    { id: "a1", role: "link", name: "Flights", landmark: "sidebar", href: "/flights", visible: true },
    { id: "a2", role: "link", name: "My Booking", landmark: "sidebar", href: "/my-booking", visible: true },
    { id: "a3", role: "link", name: "My Booking", landmark: "main", href: "/my-booking", visible: true },
  ],
};

const article: DocsEvidence = {
  documentTitle: "How do I change my seat?",
  url: "http://localhost:4150/help/how-do-i-change-my-seat",
  heading: "Change a seat online",
  snippet: "On the Manage Trip page, go to the Seats section and select Change seats.",
  similarity: 0.8,
};

describe("candidatesFor", () => {
  it("ranks the control the documentation names first, with its route from the current page", () => {
    const candidates = candidatesFor(NOVAAIR_GRAPH, "changing a seat", home, [article]);
    expect(candidates[0]?.control.name).toBe("Change seats");
    expect(candidates[0]?.pageTitle).toBe("Manage Trip | NovaAir");
    expect(candidates[0]?.route?.steps.map((step) => step.control.name)).toEqual([
      "My Booking",
      "Find my booking",
      "Change seats",
    ]);
  });

  it("lists each identity once and gives every candidate an id the model can name", () => {
    const candidates = candidatesFor(NOVAAIR_GRAPH, "my booking", home, []);
    const keys = candidates.map((candidate) => candidate.control.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(candidates.every((candidate, index) => candidate.id === `c${index + 1}`)).toBe(true);
  });
});

describe("candidatesFor with a capability the product has not got", () => {
  const seatMap: PageContext = {
    url: "http://localhost:4150/trips/NVA7K2/seats",
    title: "Choose Seats | NovaAir",
    affordances: [
      { id: "s1", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
      { id: "s2", role: "button", name: "Seat 1D, available, 45 dollars", landmark: "main", visible: true },
    ],
  };

  it("offers no control for finding seats together, on the seat map or anywhere else", () => {
    expect(candidatesFor(NOVAAIR_GRAPH, "finding seats together", seatMap, [])).toEqual([]);
    expect(candidatesFor(NOVAAIR_GRAPH, "finding seats together", home, [])).toEqual([]);
  });

  it("keeps a passage that does not cover the question from naming a control", () => {
    const children: DocsEvidence = {
      documentTitle: "Traveling with children",
      url: "http://localhost:4150/help/traveling-with-children",
      heading: "Traveling with children",
      snippet: "A child under 13 must sit next to an adult on the same booking. Change seats one at a time.",
      similarity: 0.62,
    };
    expect(candidatesFor(NOVAAIR_GRAPH, "finding seats together", seatMap, [children], false)).toEqual([]);
    // The same passage, once the documentation check says it covers the question, is a door.
    expect(
      candidatesFor(NOVAAIR_GRAPH, "finding seats together", seatMap, [children], true).map((c) => c.control.name),
    ).toContain("Change seats");
  });
});

describe("candidatesFor once the capability is built", () => {
  const seatMap: PageContext = {
    url: "http://localhost:4150/trips/NVA7K2/seats",
    title: "Choose Seats | NovaAir",
    affordances: [
      { id: "s1", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
      { id: "s2", role: "button", name: "Find seats together", landmark: "main", visible: true },
    ],
  };

  it("offers the new control, one step away, whichever verb the question used", () => {
    for (const capability of ["finding seats together", "getting seats together"]) {
      const candidates = candidatesFor(NOVAAIR_GRAPH_AFTER, capability, seatMap, []);
      expect(candidates.map((candidate) => candidate.control.name)).toEqual(["Find seats together"]);
      expect(candidates[0]?.route?.steps.length).toBe(1);
      expect(bindFirstStep(candidates[0]!.route!.steps, seatMap)?.[0]?.target).toBe("s2");
    }
  });
});

describe("candidatesFor with copies of one control", () => {
  it("lists an identity once, at the distance the user can actually walk it", () => {
    const trip: PageContext = {
      url: "http://localhost:4150/trips/NVA7K2",
      title: "Manage Trip | NovaAir",
      affordances: [],
    };
    const article: DocsEvidence = {
      documentTitle: "Baggage allowance",
      url: "http://localhost:4150/help/baggage-allowance",
      heading: "Checked bags",
      snippet: "Add bags in the Bags section of Manage Trip. Read the baggage rules for the fees.",
      similarity: 0.6,
    };
    const candidates = candidatesFor(NOVAAIR_GRAPH, "adding a checked bag", trip, [article], true);
    const names = candidates.map((candidate) => candidate.control.name);
    expect(new Set(names).size).toBe(names.length);
    // The documentation names the Bags tab, and the copy offered is the one a step away rather
    // than the same link in the footer of an article the user is not on.
    const bags = candidates.find((candidate) => candidate.control.name === "Bags");
    expect(bags?.route?.steps.length).toBe(1);
    expect(candidates.filter((candidate) => candidate.route === null)).toEqual([]);
  });
});

describe("bindFirstStep", () => {
  it("gives the first step the live id of the matching control and clears the rest", () => {
    const [candidate] = candidatesFor(NOVAAIR_GRAPH, "change seat", home, []);
    const bound = bindFirstStep(candidate!.route!.steps, home);
    expect(bound?.map((step) => step.target)).toEqual([expect.stringMatching(/^a[23]$/), null, null]);
    expect(bound?.[0]?.control?.name).toBe("My Booking");
  });

  it("returns null when the route starts with a control the page does not show", () => {
    const [candidate] = candidatesFor(NOVAAIR_GRAPH, "change seat", home, []);
    const elsewhere = { ...home, affordances: home.affordances.filter((a) => a.name !== "My Booking") };
    expect(bindFirstStep(candidate!.route!.steps, elsewhere)).toBeNull();
    expect(bindFirstStep([], home)).toBeNull();
  });

  it("does not care which page the target lives on, only that the route starts here", () => {
    const trip: PageContext = {
      url: "http://localhost:4150/trips/NVA7K2",
      title: "Manage Trip | NovaAir",
      affordances: [
        { id: "a9", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: true },
      ],
    };
    const [candidate] = candidatesFor(NOVAAIR_GRAPH, "change seat", trip, []);
    expect(candidate?.control.route).toBe(ROUTES.TRIP);
    expect(candidate?.control.key).toBe(CONTROLS.changeSeats.key);
    expect(bindFirstStep(candidate!.route!.steps, trip)?.[0]?.target).toBe("a9");
  });
});

describe("bindFirstStep with a twin of the control", () => {
  it("takes a visible copy of the same link over the one the widget could not see", () => {
    const [candidate] = candidatesFor(NOVAAIR_GRAPH, "change seat", home, []);
    const first = candidate!.route!.steps[0]!.control;
    const page: PageContext = {
      ...home,
      affordances: [
        { id: "n1", role: "link", name: "My Booking", landmark: first.landmark, href: "/my-booking", visible: false },
        { id: "h1", role: "link", name: "My Booking", landmark: first.landmark === "main" ? "sidebar" : "main", href: "/my-booking", visible: true },
      ],
    };
    const bound = bindFirstStep(candidate!.route!.steps, page);
    expect(bound?.[0]?.target).toBe("h1");
    expect(bound?.[0]?.control?.landmark).toBe(page.affordances[1]!.landmark);
  });

  it("still binds an off-screen copy when nothing visible matches, and leaves the rest to the widget", () => {
    const [candidate] = candidatesFor(NOVAAIR_GRAPH, "change seat", home, []);
    const page: PageContext = {
      ...home,
      affordances: [{ id: "n1", role: "link", name: "My Booking", landmark: "sidebar", href: "/my-booking", visible: false }],
    };
    expect(bindFirstStep(candidate!.route!.steps, page)?.[0]?.target).toBe("n1");
  });
});

/**
 * The last resort plans over the page itself, which on a seat map is a wall of controls that each
 * share one word with the question. A walk is only guidance when it ends on the control that does
 * the thing.
 */
describe("planEndsOnCapability", () => {
  const seatMap: PageContext = {
    url: "http://localhost:4150/trips/NVA7K2/seats",
    title: "Choose Seats | NovaAir",
    affordances: [
      { id: "s1", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
      { id: "s2", role: "button", name: "Seat 1D, available, 45 dollars", landmark: "main", visible: true },
      { id: "s3", role: "tab", name: "Seats", landmark: "main", visible: true },
      { id: "s4", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: true },
      { id: "s5", role: "button", name: "Confirm seats", landmark: "main", visible: true },
    ],
  };
  const step = (target: string) => ({ target, caption: `Select ${target}`, advanceOn: "click" as const });

  it("refuses a sequence of seat cells for a question about seats together", () => {
    expect(planEndsOnCapability([step("s1"), step("s2")], seatMap, "finding seats together", [])).toBe(false);
  });

  it("takes a walk that ends on the control whose name does what was asked", () => {
    expect(planEndsOnCapability([step("s3"), step("s4")], seatMap, "changing a seat", [])).toBe(true);
  });

  it("takes a control the documentation names, even when its own name does not say it", () => {
    expect(planEndsOnCapability([step("s5")], seatMap, "finding seats together", [article])).toBe(false);
    const passage: DocsEvidence = {
      ...article,
      snippet: "To sit a family together, select Confirm seats and we take the row for you.",
    };
    expect(planEndsOnCapability([step("s5")], seatMap, "finding seats together", [passage])).toBe(true);
  });

  it("refuses a plan whose last step is not on the page at all", () => {
    expect(planEndsOnCapability([step("nope")], seatMap, "changing a seat", [])).toBe(false);
  });
});
