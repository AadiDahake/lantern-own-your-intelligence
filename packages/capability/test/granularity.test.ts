import { beforeAll, describe, expect, it } from "vitest";
import {
  ARG_SLOTS,
  DEFAULT_THRESHOLDS,
  NOVAAIR_CONTEXT,
  buildToolSynthUser,
  isGrounded,
  pickGranularity,
  rejectedFor,
  reverseTaskSynthesis,
  scoreCandidates,
  segment,
  successfulTasks,
  type Candidate,
  type InferredTask,
  type RejectedCandidate,
  type Segment,
} from "../src";
import { FakeModelClient } from "./fake-model";
import { cleanSuccess, loadFixtures, trajectory, unrelated } from "./helpers";

const rows = loadFixtures();
let ok: InferredTask[];
let candidates: Candidate[];
let best: Candidate;
let rejected: RejectedCandidate[];

beforeAll(async () => {
  const { kept } = await reverseTaskSynthesis(rows, NOVAAIR_CONTEXT, new FakeModelClient(), DEFAULT_THRESHOLDS.min_reward_total);
  ok = successfulTasks(kept, DEFAULT_THRESHOLDS);
  candidates = scoreCandidates(ok);
  const pick = pickGranularity(candidates, DEFAULT_THRESHOLDS, ok.length);
  best = pick.best as Candidate;
  rejected = rejectedFor(candidates, best, DEFAULT_THRESHOLDS);
});

describe("ARG_SLOTS", () => {
  it("finds the properties that varied across sessions and not the constants", () => {
    const slots = ARG_SLOTS(best.segments);
    for (const name of ["flight_id", "seat", "passenger_index", "party_size"]) expect(slots.arguments).toContain(name);
    expect(slots.arguments).not.toContain("currency");
    expect(slots.constants).toContain("currency");
    expect(slots.constants).toContain("cabin");
    expect(slots.types.party_size).toBe("integer");
    expect(slots.types.seat).toBe("string");
    expect(slots.types.current_seats).toBe("string[]");
    expect(slots.types.same_row).toBe("boolean");
  });

  it("ignores a property whose type changes and PostHog's own properties", () => {
    const make = (props: Record<string, unknown>): Segment => ({
      session_id: "s",
      goal: "g",
      level: 0,
      key: "k",
      weight: 5,
      steps: [{ t: "2026-08-01T10:00:00.000Z", event: "seat_selected", props }],
    });
    const slots = ARG_SLOTS([make({ seat: "1A", price: 0, $lib: "web" }), make({ seat: "2B", price: "free", $lib: "ios" })]);
    expect(slots.arguments).toEqual(["seat"]);
    expect(Object.keys(slots.types)).not.toContain("price");
    expect(Object.keys(slots.types)).not.toContain("$lib");
  });
});

describe("bottom-up merging", () => {
  it("segments one trajectory at four levels", () => {
    const task: InferredTask = {
      trajectory: trajectory("t", [
        ["help_article_viewed", { slug: "traveling-with-children" }],
        ["seat_map_opened", { flight_id: "NA214", party_size: 2 }],
        ["seat_hovered", { seat: "21A" }],
        ["seat_hovered", { seat: "21B" }],
        ["passenger_selected", { passenger_index: 0 }],
        ["seat_selected", { seat: "21A", passenger_index: 0 }],
        ["seat_assignment_confirmed", { seats: ["21A"], same_row: true }],
        ["help_article_viewed", { slug: "check-in" }],
      ]),
      rendered: "",
      goal: { session_id: "t", goal_sentence: "", goal_name: "seat_party_together", confidence: 1 },
      reward: { completion: 5, coherence: 5, total: 5, why: "" },
    };
    expect(segment(task, 0)).toHaveLength(8);
    expect(segment(task, 1).map((s) => s.key)).toEqual(["help", "open", "scan", "assign", "confirm", "help"]);
    const windows = segment(task, 2);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.steps.map((s) => s.event)).toEqual([
      "seat_map_opened",
      "seat_hovered",
      "seat_hovered",
      "passenger_selected",
      "seat_selected",
      "seat_assignment_confirmed",
    ]);
    expect(segment(task, 3)).toHaveLength(1);
    expect(segment(task, 3)[0]?.steps).toHaveLength(8);
  });

  it("anchors a segment to one observed end state", () => {
    const seg = (events: string[]): Segment => ({
      session_id: "s",
      goal: "g",
      level: 2,
      key: "window",
      weight: 5,
      steps: events.map((event) => ({ t: "2026-08-01T10:00:00.000Z", event, props: {} })),
    });
    expect(isGrounded(seg(["seat_map_opened", "seat_selected", "seat_assignment_confirmed"]))).toBe(true);
    expect(isGrounded(seg(["seat_selected", "seat_selected"]))).toBe(true);
    expect(isGrounded(seg(["seat_map_opened", "seat_assignment_confirmed", "help_article_viewed"]))).toBe(false);
    expect(isGrounded(seg(["seat_map_opened", "seat_assignment_confirmed", "seat_map_opened", "seat_assignment_confirmed"]))).toBe(false);
  });

  it("picks the seat-party level: the largest grounded merge that half the sessions share", () => {
    expect(best.level).toBe(2);
    expect(best.name).toBe("seat_party_together");
    expect(best.sessions).toHaveLength(63);
    expect(best.replaces).toBe(14);
    expect(best.support).toBeGreaterThan(0.9);
    expect(best.grounded).toBe(true);
  });

  it("records click_seat-level and manage_trip-level rejections", () => {
    const below = rejected.filter((r) => r.level < best.level && r.goal === best.goal);
    const above = rejected.filter((r) => r.level > best.level && r.goal === best.goal);
    expect(below.map((r) => r.name)).toContain("click_seat");
    expect(below.map((r) => r.name)).toContain("scan_rows");
    expect(below.find((r) => r.name === "click_seat")?.reason).toMatch(/too small: replaces 1 step/);
    expect(above.map((r) => r.name)).toEqual(["manage_trip"]);
    expect(above[0]?.grounded).toBe(false);
    expect(above[0]?.reason).toBe("not grounded in one observed end state");
  });

  it("gives the naming prompt the rejected candidates below and above the winner", () => {
    const user = buildToolSynthUser(NOVAAIR_CONTEXT, best, "Seat the traveling party together", ok.length, rejected);
    expect(user).toMatch(/Rejected, one level down \(too small\): .*click_seat/);
    expect(user).toMatch(/Rejected, one level up \(not grounded in any single end state\): manage_trip/);
    expect(user).toMatch(/Properties that varied across sessions: .*party_size/);
    expect(user).toMatch(/Properties that never varied: .*currency/);
    expect(user).toContain("Sessions explaining this pattern: 63 of");
    expect(user).toContain("Median manual steps replaced: 14.");
    expect(user).toContain("Representative segment (session ");
  });

  it("returns no capability, with reasons, when the sessions do not warrant one", async () => {
    const few = unrelated(rows);
    const { kept } = await reverseTaskSynthesis(few, NOVAAIR_CONTEXT, new FakeModelClient(), DEFAULT_THRESHOLDS.min_reward_total);
    const fewOk = successfulTasks(kept, DEFAULT_THRESHOLDS);
    const pick = pickGranularity(scoreCandidates(fewOk), DEFAULT_THRESHOLDS, fewOk.length);
    expect(pick.best).toBeNull();
    expect(pick.reasons.join("\n")).toMatch(/the floor is 5/);
    expect(pick.reasons.join("\n")).toMatch(/replaces a median of 2.5 manual steps; the floor is 3/);
  });

  it("returns no capability when nothing is shared by half the sessions", () => {
    const tasks: InferredTask[] = [cleanSuccess("a"), cleanSuccess("b")].map((t, i) => ({
      trajectory: t,
      rendered: "",
      goal: { session_id: t.session_id, goal_sentence: "", goal_name: i === 0 ? "goal_one" : "goal_two", confidence: 1 },
      reward: { completion: 5, coherence: 5, total: 5, why: "" },
    }));
    const pick = pickGranularity(scoreCandidates(tasks), { ...DEFAULT_THRESHOLDS, min_sessions: 1, min_support: 0.75 }, tasks.length);
    expect(pick.best).toBeNull();
    expect(pick.reasons.join("\n")).toMatch(/only 50% of the sessions share it; the floor is 75%/);
  });
});
