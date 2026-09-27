import { describe, expect, it } from "vitest";
import { controlKey } from "@lantern/shared";
import type { PageContext } from "@lantern/shared";
import { intentKey } from "@/lib/graph/intent";
import { mapWithCurrentPage } from "@/lib/graph/live";
import { belongsToSite } from "@/lib/graph/origin";
import { controlRows } from "@/lib/graph/store";

const page: PageContext = {
  url: "http://localhost:4150/trips/NVA7K2",
  title: "Manage Trip | NovaAir",
  affordances: [
    { id: "a1", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: true },
    { id: "a2", role: "tab", name: "Seats", landmark: "main", visible: true, state: "selected" },
    { id: "a3", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: false },
    { id: "a4", role: "button", name: "", visible: true },
    { id: "a5", role: "button", name: "Disabled thing", visible: true, disabled: true },
  ],
};

describe("controlRows", () => {
  it("keys controls by identity with the link target normalised, once each", () => {
    const rows = controlRows(page);
    expect(rows.map((row) => row.key)).toEqual([
      "link|change seats|main|/trips/:id/seats",
      "tab|seats|main|",
    ]);
    expect(rows[0]).toMatchObject({ role: "link", name: "Change seats", landmark: "main", href: "/trips/:id/seats" });
  });

  it("keeps a control visible if any copy of it was visible, and drops nameless or disabled ones", () => {
    const rows = controlRows(page);
    expect(rows[0]?.visible).toBe(true);
    expect(rows.some((row) => row.name === "" || row.name === "Disabled thing")).toBe(false);
  });

  it("agrees with the shared key of the same identity", () => {
    const [row] = controlRows(page);
    expect(row?.key).toBe(controlKey({ role: "link", name: "Change seats", landmark: "main", href: "/trips/:id/seats" }));
  });
});

describe("intentKey", () => {
  it("is the same for two wordings with the same concepts", () => {
    expect(intentKey("Where do I change my seat?")).toBe(intentKey("how can I change seats"));
    expect(intentKey("Where do I change my seat?")).not.toBe(intentKey("Where do I add a bag?"));
  });
});

/**
 * A preview deployment of an unmerged branch serves the same product on another origin. One visit
 * to it used to teach the project's product map a control the live site has not got, and the next
 * visitor on the live site was walked to a button that was not there.
 */
describe("belongsToSite", () => {
  const SITE = "https://novaair.example.com";
  const PREVIEW = "https://novaair-git-a1b2c3.example.com/trips/NVA7K2/seats";

  it("refuses a Vercel preview deployment of the same product", () => {
    expect(belongsToSite(SITE, PREVIEW)).toBe(false);
  });

  it("takes any page of the site the project names, whatever the path or the query", () => {
    expect(belongsToSite(SITE, `${SITE}/trips/NVA7K2/seats?passenger=2`)).toBe(true);
    expect(belongsToSite(`${SITE}/help/index.html`, `${SITE}/`)).toBe(true);
  });

  it("separates the scheme, the host and the port, because each is a different deployment", () => {
    expect(belongsToSite("https://novaair.example.com", "http://novaair.example.com/")).toBe(false);
    expect(belongsToSite("http://localhost:4150", "http://localhost:4151/")).toBe(false);
    expect(belongsToSite("http://localhost:4150", "http://localhost:4150/trips")).toBe(true);
  });

  it("takes everything while the project has not said where it lives", () => {
    expect(belongsToSite(null, PREVIEW)).toBe(true);
    expect(belongsToSite("", PREVIEW)).toBe(true);
    expect(belongsToSite("not a url", PREVIEW)).toBe(true);
  });

  it("refuses a page whose own address cannot be read", () => {
    expect(belongsToSite(SITE, "about:blank")).toBe(false);
  });
});

/**
 * The page the visitor is standing on is part of the map for the length of one turn, whether or
 * not it was ever written down. A control that is on screen is a control the agent may point at.
 */
describe("mapWithCurrentPage", () => {
  const seatMap: PageContext = {
    url: "https://novaair-git-a1b2c3.example.com/trips/NVA7K2/seats",
    title: "Choose Seats | NovaAir",
    affordances: [
      { id: "s1", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
      { id: "s2", role: "button", name: "Find three seats together", landmark: "sidebar", visible: true },
    ],
  };

  it("adds the controls of the page the visitor is on, keyed the way the map keys them", () => {
    const merged = mapWithCurrentPage({ pages: [], controls: [], transitions: [] }, seatMap);
    expect(merged.controls.map((control) => control.key)).toEqual([
      "button|seat 1c, available, 45 dollars|main|",
      "button|find three seats together|sidebar|",
    ]);
    expect(merged.controls.every((control) => control.route === "/trips/:id/seats")).toBe(true);
    expect(merged.pages.map((page) => page.route)).toEqual(["/trips/:id/seats"]);
  });

  it("leaves a control the map already holds exactly as it was stored", () => {
    const stored = {
      pages: [
        {
          route: "/trips/:id/seats",
          url: "http://localhost:4150/trips/NVA7K2/seats",
          title: "Choose Seats | NovaAir",
          source: "explorer",
          firstSeen: "2026-08-01T00:00:00.000Z",
          lastSeen: "2026-08-01T00:00:00.000Z",
        },
      ],
      controls: [
        {
          id: "control-1",
          route: "/trips/:id/seats",
          key: "button|seat 1c, available, 45 dollars|main|",
          role: "button",
          name: "Seat 1C, available, 45 dollars",
          landmark: "main",
          visible: true,
          seenCount: 4,
          lastSeen: "2026-08-01T00:00:00.000Z",
        },
      ],
      transitions: [],
    };

    const merged = mapWithCurrentPage(stored, seatMap);
    expect(merged.controls).toHaveLength(2);
    expect(merged.controls[0]).toBe(stored.controls[0]);
    expect(merged.pages).toBe(stored.pages);
  });

  it("changes nothing when the page adds nothing the map has not got", () => {
    const graph = mapWithCurrentPage({ pages: [], controls: [], transitions: [] }, seatMap);
    expect(mapWithCurrentPage(graph, seatMap)).toBe(graph);
  });
});
