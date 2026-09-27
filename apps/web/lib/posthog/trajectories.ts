/**
 * From the trajectory query's rows to the compiler's `Trajectory` shape.
 *
 * Every property comes back as a string or null, so this is where each one gets its type back,
 * where NovaAir's refusal reasons are spelled the way the compiler's contract spells them, and
 * where a development-mode double mount that sent the opening event twice is collapsed.
 */
import type { Trajectory, TrajectoryStep } from "@lantern/capability";
import { STEP_PROPERTIES, TRAJECTORY_COLUMNS, type StepProperty } from "./hogql";

const NUMBERS = new Set<StepProperty>(["row", "passenger_index", "price", "party_size", "additional_cost", "interactions", "elapsed_ms"]);
const BOOLEANS = new Set<StepProperty>(["same_row", "contiguous"]);
const ARRAYS = new Set<StepProperty>(["current_seats", "seats"]);

/**
 * NovaAir's `seat_selection_rejected.reason` values, in the compiler's words. The compiler's
 * scenario rules key on the right-hand side (`booked`, `blocked`, `child_in_exit_row`), so a
 * reason that arrived under the product's own name would silently drop a verification scenario.
 */
export const REASON_ALIASES: Record<string, string> = {
  seat_booked: "booked",
  seat_blocked: "blocked",
  exit_row_child: "child_in_exit_row",
  seat_taken_by_party: "taken_by_party",
};

/** Two opening events within this many milliseconds are one mount, not two. */
const DUPLICATE_WINDOW_MS = 1000;

function coerce(name: StepProperty, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw);
  if (text === "" || text === "null") return undefined;
  if (NUMBERS.has(name)) {
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (BOOLEANS.has(name)) return text === "true" ? true : text === "false" ? false : undefined;
  if (ARRAYS.has(name)) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      return undefined;
    }
  }
  if (name === "reason") return REASON_ALIASES[text] ?? text;
  return text;
}

/** One `(timestamp, event, ...properties)` tuple to a step. Null when the tuple is malformed. */
export function toStep(tuple: unknown): TrajectoryStep | null {
  if (!Array.isArray(tuple) || tuple.length < 2) return null;
  const [t, event, ...rest] = tuple as unknown[];
  if (typeof t !== "string" || typeof event !== "string") return null;
  const props: Record<string, unknown> = {};
  STEP_PROPERTIES.forEach((name, index) => {
    const value = coerce(name, rest[index]);
    if (value !== undefined) props[name] = value;
  });
  return { t: new Date(t).toISOString(), event, props };
}

function sameStep(a: TrajectoryStep, b: TrajectoryStep): boolean {
  return a.event === b.event && JSON.stringify(a.props) === JSON.stringify(b.props);
}

/** Drops a step that repeats the previous one within a second: a double mount, not a workflow. */
export function collapseDuplicates(steps: TrajectoryStep[]): TrajectoryStep[] {
  const out: TrajectoryStep[] = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    if (last && sameStep(last, step) && Date.parse(step.t) - Date.parse(last.t) < DUPLICATE_WINDOW_MS) continue;
    out.push(step);
  }
  return out;
}

/** One result row to a trajectory. Null when the row has no session id or no steps. */
export function toTrajectory(columns: readonly string[], row: unknown[]): Trajectory | null {
  const at = (name: (typeof TRAJECTORY_COLUMNS)[number]): unknown => {
    const index = columns.indexOf(name);
    return index === -1 ? undefined : row[index];
  };
  const sessionId = at("session_id");
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const rawSteps = at("steps");
  const steps = collapseDuplicates(
    (Array.isArray(rawSteps) ? rawSteps : []).map(toStep).filter((step): step is TrajectoryStep => step !== null),
  );
  if (steps.length === 0) return null;
  const opened = at("opened_at");
  const confirmed = at("confirmed_at");
  const distinct = at("distinct_id");
  const duration = Number(at("duration_seconds"));
  return {
    session_id: sessionId,
    ...(typeof distinct === "string" && distinct ? { distinct_id: distinct } : {}),
    opened_at: typeof opened === "string" ? new Date(opened).toISOString() : (steps[0] as TrajectoryStep).t,
    confirmed_at: typeof confirmed === "string" ? new Date(confirmed).toISOString() : null,
    duration_seconds: Number.isFinite(duration) ? duration : 0,
    step_count: steps.length,
    steps,
  };
}

/** Every well-formed row of a trajectory query result, in the order PostHog returned them. */
export function toTrajectories(columns: readonly string[], results: unknown[][]): Trajectory[] {
  return results.map((row) => toTrajectory(columns, row)).filter((t): t is Trajectory => t !== null);
}
