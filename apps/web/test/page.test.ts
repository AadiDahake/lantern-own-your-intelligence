import { describe, expect, it } from "vitest";
import { MAX_PAGE_TEXT, affordanceList, dropRepeats, pageText, visibleAffordances } from "@/lib/agent/page";
import type { Affordance, PageContext, Step } from "@lantern/shared";

function affordance(id: string, name: string, extra: Partial<Affordance> = {}): Affordance {
  return { id, role: "button", name, visible: true, ...extra };
}

function pageOf(affordances: Affordance[]): PageContext {
  return { url: "https://example.test/", title: "Example", affordances };
}

describe("affordanceList", () => {
  it("says where a control is, what state it is in, and whether it is on screen", () => {
    const list = affordanceList([
      affordance("a1", "Profile", { role: "tab", landmark: "dialog", state: "selected" }),
      affordance("a2", "Log out", { role: "menuitem", visible: false }),
    ]);
    expect(list).toBe('a1: tab "Profile" (in dialog, selected)\na2: menuitem "Log out" (not on screen yet)');
  });
});

describe("visibleAffordances", () => {
  it("keeps only what the user can reach", () => {
    const page = pageOf([affordance("a1", "Username"), affordance("a2", "Log out", { visible: false })]);
    expect(visibleAffordances(page).map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("falls back to the whole list rather than leaving the model nothing to point at", () => {
    const page = pageOf([affordance("a1", "Username", { visible: false })]);
    expect(visibleAffordances(page)).toHaveLength(1);
  });
});

describe("dropRepeats", () => {
  it("drops a step that points at the control the step before it already used", () => {
    const steps: Step[] = [
      { target: "a1", caption: "Open the account menu", advanceOn: "click" },
      { target: "a1", caption: "Choose Profile", advanceOn: "click" },
      { target: "a3", caption: "Type the new username", advanceOn: "input" },
    ];
    expect(dropRepeats(steps).map((step) => step.target)).toEqual(["a1", "a3"]);
  });
});

describe("pageText", () => {
  it("collapses the page's own words into one line", () => {
    const page = { ...pageOf([]), text: "  Manage Trip.\n\n  Confirmation   NVA7K2.  " };
    expect(pageText(page)).toBe("Manage Trip. Confirmation NVA7K2.");
  });

  it("is empty when the widget sent no text, so an old widget still works", () => {
    expect(pageText(pageOf([]))).toBe("");
    expect(pageText({ ...pageOf([]), text: 7 as unknown as string })).toBe("");
  });

  it("clamps what a customer's site sends, because the route is public", () => {
    const page = { ...pageOf([]), text: "word ".repeat(2000) };
    expect(pageText(page)).toHaveLength(MAX_PAGE_TEXT);
  });
});
