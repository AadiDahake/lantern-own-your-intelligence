import { describe, expect, it } from "vitest";
import { advanceOnFor, captionFor, controlKey, controlRefOf, hrefRoute, routeOf, sameControl } from "../src/site";

describe("routeOf", () => {
  it("replaces identifiers with :id and keeps names", () => {
    expect(routeOf("http://localhost:4150/trips/NVA7K2/seats")).toBe("/trips/:id/seats");
    expect(routeOf("/trips/QX91LM")).toBe("/trips/:id");
    expect(routeOf("/help/how-do-i-change-my-seat")).toBe("/help/how-do-i-change-my-seat");
    expect(routeOf("/users/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e/profile")).toBe("/users/:id/profile");
  });

  it("drops the query and the fragment, and normalises the root", () => {
    expect(routeOf("http://site/?lantern_ask=hi#main")).toBe("/");
    expect(routeOf("/my-booking/?x=1")).toBe("/my-booking");
  });
});

describe("hrefRoute", () => {
  it("resolves a relative link against the page", () => {
    expect(hrefRoute("/trips/NVA7K2/seats", "http://localhost:4150/trips/NVA7K2")).toBe("/trips/:id/seats");
    expect(hrefRoute("seats", "http://localhost:4150/trips/NVA7K2/")).toBe("/trips/:id/seats");
  });

  it("keeps the origin of a link to another site", () => {
    expect(hrefRoute("https://other.example/docs/1", "http://localhost:4150/")).toBe("https://other.example/docs/:id");
  });

  it("has no target for mail, phone, script and fragment links", () => {
    for (const href of ["mailto:a@b.c", "tel:18005550142", "javascript:void(0)", "#main", ""]) {
      expect(hrefRoute(href, "http://localhost:4150/")).toBeUndefined();
    }
  });
});

describe("controlKey and sameControl", () => {
  it("ignores case and spacing in the name", () => {
    expect(controlKey({ role: "Button", name: "Find  my Booking", landmark: "form" })).toBe("button|find my booking|form|");
  });

  it("builds the key from a scanned affordance with the link normalised", () => {
    const ref = controlRefOf(
      { id: "a1", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: true },
      "http://localhost:4150/trips/NVA7K2",
    );
    expect(ref).toEqual({ role: "link", name: "Change seats", landmark: "main", href: "/trips/:id/seats" });
  });

  it("matches when one side lacks a landmark, and refuses a different link target", () => {
    expect(sameControl({ role: "link", name: "Seats" }, { role: "link", name: "seats", landmark: "main" })).toBe(true);
    expect(
      sameControl({ role: "link", name: "Seats", href: "/a" }, { role: "link", name: "Seats", href: "/b" }),
    ).toBe(false);
    expect(sameControl({ role: "tab", name: "Seats" }, { role: "link", name: "Seats" })).toBe(false);
  });
});

describe("captionFor and advanceOnFor", () => {
  it("writes an instruction from the role and the name", () => {
    expect(captionFor({ role: "link", name: "My Booking" })).toBe("Open My Booking");
    expect(captionFor({ role: "tab", name: "Seats" })).toBe("Select the Seats tab");
    expect(captionFor({ role: "button", name: "Find my booking", landmark: "form" })).toBe(
      "Fill in the form, then select Find my booking",
    );
    expect(captionFor({ role: "textbox", name: "Last name" })).toBe("Type in Last name");
    expect(captionFor({ role: "button", name: "Confirm seats" })).toBe("Select Confirm seats");
  });

  it("keeps a long accessible name within a caption", () => {
    const caption = captionFor({ role: "button", name: "one two three four five six seven eight nine ten" });
    expect(caption.split(" ").length).toBeLessThanOrEqual(10);
    expect(caption.endsWith("...")).toBe(true);
  });

  it("advances on navigation for links that navigate and on input for fields", () => {
    expect(advanceOnFor({ role: "link", name: "x" }, true)).toBe("navigation");
    expect(advanceOnFor({ role: "tab", name: "x" }, false)).toBe("click");
    expect(advanceOnFor({ role: "textbox", name: "x" }, false)).toBe("input");
  });
});
