import { describe, expect, it } from "vitest";
import { validatePlan } from "../src/plan";
import type { Affordance, Step } from "../src/types";

const affordances: Affordance[] = [
  { id: "a1", role: "button", name: "Account", visible: true },
  { id: "a2", role: "menuitem", name: "Profile", visible: true },
  { id: "a3", role: "textbox", name: "Username", visible: true },
];

const step = (over: Partial<Step> = {}): Step => ({
  target: "a1",
  caption: "Open the account menu",
  advanceOn: "click",
  ...over,
});

describe("validatePlan", () => {
  it("accepts a plan whose targets are all known", () => {
    const plan = [step(), step({ target: "a2", caption: "Choose Profile" })];
    expect(validatePlan(plan, affordances)).toEqual(plan);
  });

  it("rejects the whole plan when any target is unknown", () => {
    const plan = [step(), step({ target: "a9", caption: "Choose Profile" })];
    expect(validatePlan(plan, affordances)).toBeNull();
  });

  it("rejects a caption longer than fourteen words", () => {
    const caption = Array.from({ length: 15 }, () => "word").join(" ");
    expect(validatePlan([step({ caption })], affordances)).toBeNull();
  });

  it("accepts a caption of exactly fourteen words", () => {
    const caption = Array.from({ length: 14 }, () => "word").join(" ");
    expect(validatePlan([step({ caption })], affordances)).not.toBeNull();
  });

  it("rejects an empty plan and one longer than five steps", () => {
    expect(validatePlan([], affordances)).toBeNull();
    expect(validatePlan(Array.from({ length: 6 }, () => step()), affordances)).toBeNull();
  });

  it("rejects an unknown advanceOn value", () => {
    const bad = { target: "a1", caption: "Open it", advanceOn: "hover" } as unknown as Step;
    expect(validatePlan([bad], affordances)).toBeNull();
  });

  it("rejects a blank caption and trims the ones it keeps", () => {
    expect(validatePlan([step({ caption: "   " })], affordances)).toBeNull();
    expect(validatePlan([step({ caption: "  Open the menu  " })], affordances)?.[0]?.caption).toBe(
      "Open the menu",
    );
  });

  it("rejects a plan when there are no affordances at all", () => {
    expect(validatePlan([step()], [])).toBeNull();
  });
});

describe("validatePlan with steps on later pages", () => {
  const later = (over: Partial<Step> = {}): Step => ({
    target: null,
    caption: "Open Change seats",
    advanceOn: "navigation",
    control: { role: "link", name: "Change seats", landmark: "main", href: "/trips/:id/seats", route: "/trips/:id" },
    ...over,
  });

  it("accepts a later-page step that names its control, and keeps the control on it", () => {
    const plan = validatePlan([step(), later()], affordances);
    expect(plan).toHaveLength(2);
    expect(plan?.[1]?.target).toBeNull();
    expect(plan?.[1]?.control?.route).toBe("/trips/:id");
  });

  it("rejects a later-page step with no control identity", () => {
    expect(validatePlan([step(), later({ control: undefined })], affordances)).toBeNull();
    expect(
      validatePlan([step(), later({ control: { role: "link", name: "", route: "/x" } })], affordances),
    ).toBeNull();
  });

  it("insists the first step has a live id, because it is what the spotlight draws now", () => {
    expect(validatePlan([later(), step()], affordances)).toBeNull();
  });

  it("allows a longer route when told to", () => {
    const route = [step(), ...Array.from({ length: 6 }, () => later())];
    expect(validatePlan(route, affordances)).toBeNull();
    expect(validatePlan(route, affordances, 8)).toHaveLength(7);
  });
});
