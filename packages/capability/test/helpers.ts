import { readFileSync } from "node:fs";
import type { Trajectory, TrajectoryStep } from "../src/types";

export const FIXTURES = new URL("./fixtures/sessions.json", import.meta.url);

export function loadFixtures(): Trajectory[] {
  return JSON.parse(readFileSync(FIXTURES, "utf8")) as Trajectory[];
}

/** The help-only sessions and the single seat changes: sessions that must not become a capability. */
export function unrelated(rows: Trajectory[]): Trajectory[] {
  return rows.filter(
    (r) =>
      r.steps.every((s) => s.event === "help_article_viewed") ||
      r.steps.some((s) => s.event === "seat_map_opened" && s.props.party_size === 1),
  );
}

/** Sessions that confirmed a party of two or more together. */
export function family(rows: Trajectory[]): Trajectory[] {
  return rows.filter((r) =>
    r.steps.some((s) => s.event === "seat_assignment_confirmed" && s.props.same_row === true && (s.props.party_size as number) > 1),
  );
}

/** A small builder for hand-written trajectories in tests. */
export function trajectory(id: string, events: Array<[string, Record<string, unknown>, number?]>): Trajectory {
  let t = Date.parse("2026-08-10T09:00:00.000Z");
  const steps: TrajectoryStep[] = events.map(([event, props, seconds]) => {
    t += (seconds ?? 5) * 1000;
    return { t: new Date(t).toISOString(), event, props };
  });
  const opened = steps.find((s) => s.event === "seat_map_opened")?.t ?? steps[0]?.t ?? new Date(t).toISOString();
  const confirmed = [...steps].reverse().find((s) => s.event === "seat_assignment_confirmed")?.t ?? null;
  return {
    session_id: id,
    opened_at: opened,
    confirmed_at: confirmed,
    duration_seconds: confirmed ? Math.round((Date.parse(confirmed) - Date.parse(opened)) / 1000) : 0,
    step_count: steps.length,
    steps,
  };
}

/** Wandered through refusals and re-selections, then confirmed the party together. */
export function wanderingThenSuccess(id = "wander-1"): Trajectory {
  return trajectory(id, [
    ["seat_map_opened", { reservation_code: "NVA7K2", flight_id: "NA214", party_size: 3, current_seats: ["12A", "18C", "24F"], cabin: "economy" }, 0],
    ["seat_hovered", { seat: "14A", row: 14, column: "A", state: "booked" }, 3],
    ["seat_hovered", { seat: "14B", row: 14, column: "B", state: "booked" }, 2],
    ["passenger_selected", { passenger_index: 0, passenger_type: "adult" }, 4],
    ["seat_selection_rejected", { seat: "14A", reason: "booked" }, 3],
    ["seat_selection_rejected", { seat: "16C", reason: "child_in_exit_row" }, 4],
    ["seat_selected", { seat: "9A", row: 9, column: "A", passenger_index: 0, state: "available", price: 0, currency: "USD" }, 6],
    ["seat_hovered", { seat: "17D", row: 17, column: "D", state: "booked" }, 5],
    ["seat_selection_rejected", { seat: "20D", reason: "blocked" }, 3],
    ["seat_selected", { seat: "22D", row: 22, column: "D", passenger_index: 0, state: "available", price: 0, currency: "USD" }, 7],
    ["passenger_selected", { passenger_index: 1, passenger_type: "child" }, 3],
    ["seat_selected", { seat: "22E", row: 22, column: "E", passenger_index: 1, state: "available", price: 0, currency: "USD" }, 5],
    ["passenger_selected", { passenger_index: 2, passenger_type: "child" }, 3],
    ["seat_selected", { seat: "22F", row: 22, column: "F", passenger_index: 2, state: "available", price: 0, currency: "USD" }, 4],
    ["seat_assignment_confirmed", { seats: ["22D", "22E", "22F"], party_size: 3, same_row: true, contiguous: true, additional_cost: 0, currency: "USD", interactions: 12, elapsed_ms: 52000 }, 8],
  ]);
}

/** Went straight to the seats and confirmed. */
export function cleanSuccess(id = "clean-1"): Trajectory {
  return trajectory(id, [
    ["seat_map_opened", { reservation_code: "A1B2C3", flight_id: "NA412", party_size: 3, current_seats: ["5C", "19A", "27F"], cabin: "economy" }, 0],
    ["seat_hovered", { seat: "21A", row: 21, column: "A", state: "available" }, 38],
    ["passenger_selected", { passenger_index: 0, passenger_type: "adult" }, 2],
    ["seat_selected", { seat: "21A", row: 21, column: "A", passenger_index: 0, state: "available", price: 0, currency: "USD" }, 3],
    ["passenger_selected", { passenger_index: 1, passenger_type: "child" }, 2],
    ["seat_selected", { seat: "21B", row: 21, column: "B", passenger_index: 1, state: "available", price: 0, currency: "USD" }, 3],
    ["passenger_selected", { passenger_index: 2, passenger_type: "child" }, 2],
    ["seat_selected", { seat: "21C", row: 21, column: "C", passenger_index: 2, state: "available", price: 0, currency: "USD" }, 3],
    ["seat_assignment_confirmed", { seats: ["21A", "21B", "21C"], party_size: 3, same_row: true, contiguous: true, additional_cost: 0, currency: "USD", interactions: 7, elapsed_ms: 60000 }, 15],
  ]);
}
