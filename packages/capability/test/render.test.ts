import { describe, expect, it } from "vitest";
import { countManualActions, fillTemplate, renderFinalStates, renderStep, renderTrajectory } from "../src";
import { cleanSuccess, trajectory } from "./helpers";

const step = (event: string, props: Record<string, unknown>) => ({ t: "2026-08-01T10:00:00.000Z", event, props });

describe("renderStep", () => {
  it("renders every event in NovaAir's contract as prose", () => {
    expect(renderStep(step("seat_map_opened", { flight_id: "NA214", party_size: 3, current_seats: ["12A", "18C", "24F"] }))).toBe(
      "opened the seat map for flight NA214 (party of 3, seated at 12A, 18C, 24F)",
    );
    expect(renderStep(step("passenger_selected", { passenger_index: 1, passenger_type: "child" }))).toBe("chose passenger 1 (child)");
    expect(renderStep(step("seat_hovered", { seat: "14A", row: 14, column: "A", state: "booked" }))).toBe("hovered seat 14A (booked)");
    expect(renderStep(step("seat_selected", { seat: "21A", passenger_index: 0, state: "available", price: 0 }))).toBe(
      "selected seat 21A for passenger 0, available, $0",
    );
    expect(renderStep(step("seat_selection_rejected", { seat: "16C", reason: "child_in_exit_row" }))).toBe(
      "was refused seat 16C: child_in_exit_row",
    );
    expect(
      renderStep(step("seat_assignment_confirmed", { seats: ["21A", "21B", "21C"], same_row: true, contiguous: true, additional_cost: 0, interactions: 14 })),
    ).toBe("confirmed seats 21A, 21B, 21C (same row: true, contiguous: true, extra cost $0, 14 interactions)");
    expect(renderStep(step("help_article_viewed", { slug: "check-in" }))).toBe('read the help article "check-in"');
  });

  it("drops optional detail when a property is missing", () => {
    expect(renderStep(step("seat_map_opened", { flight_id: "NA214" }))).toBe("opened the seat map for flight NA214");
    expect(renderStep(step("seat_selected", { seat: "21A", passenger_index: 2 }))).toBe("selected seat 21A for passenger 2");
  });

  it("falls back to the event name and its properties for an unknown event", () => {
    expect(renderStep(step("coupon_applied", { code: "SAVE10", $lib: "web" }))).toBe("coupon applied {code=SAVE10}");
  });
});

describe("fillTemplate", () => {
  it("substitutes and keeps a bracketed segment only when all its properties exist", () => {
    expect(fillTemplate("a {x}[ and {y}]", { x: 1, y: 2 })).toBe("a 1 and 2");
    expect(fillTemplate("a {x}[ and {y}]", { x: 1 })).toBe("a 1");
    expect(fillTemplate("a {x}[ and {y}]", { x: 1, y: null })).toBe("a 1");
  });
});

describe("renderTrajectory", () => {
  it("numbers the steps and shows the delay since the previous one", () => {
    const lines = renderTrajectory(cleanSuccess()).split("\n");
    expect(lines[0]).toBe("0. opened the seat map for flight NA412 (party of 3, seated at 5C, 19A, 27F)");
    expect(lines[1]).toBe("1. hovered seat 21A (available) (+38s)");
    expect(lines[2]).toBe("2. chose passenger 0 (adult) (+2s)");
    expect(lines[lines.length - 1]).toMatch(/^8\. confirmed seats 21A, 21B, 21C .* \(\+15s\)$/);
  });

  it("shows the last three states with their indices for the reward model", () => {
    const final = renderFinalStates(cleanSuccess()).split("\n");
    expect(final).toHaveLength(3);
    expect(final[0]).toBe("step 6 -> passenger_selected {passenger_index=2, passenger_type=child}");
    expect(final[2]).toMatch(/^step 8 -> seat_assignment_confirmed \{seats=21A, 21B, 21C/);
  });
});

describe("countManualActions", () => {
  it("counts picks, hovers, selections and refusals, not opening, confirming or reading", () => {
    const t = trajectory("x", [
      ["help_article_viewed", { slug: "a" }],
      ["seat_map_opened", { flight_id: "NA214" }],
      ["seat_hovered", { seat: "1A" }],
      ["passenger_selected", { passenger_index: 0 }],
      ["seat_selection_rejected", { seat: "1A", reason: "booked" }],
      ["seat_selected", { seat: "1B" }],
      ["seat_assignment_confirmed", { seats: ["1B"] }],
    ]);
    expect(countManualActions(t.steps)).toBe(4);
  });
});
