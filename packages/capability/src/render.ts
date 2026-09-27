/**
 * `f_low` without a model.
 *
 * OS-Genesis maps each `<state, action, state>` triplet to a low-level instruction with a model.
 * A product analytics event already is that instruction in words: `seat_selected {seat: "21B"}`
 * needs no model to become "selected seat 21B". So the rendering is a table lookup plus a timing
 * delta, which keeps the compiler cheap and deterministic. The table is `contract.ts`.
 */
import { EVENTS, specFor } from "./contract";
import type { Trajectory, TrajectoryStep } from "./types";

function show(value: unknown): string {
  if (Array.isArray(value)) return value.map(show).join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Fill a verb template. `{name}` becomes the property's value. A `[ ... ]` segment is kept only
 * when every property it names is present, so optional detail disappears cleanly.
 */
export function fillTemplate(template: string, props: Record<string, unknown>): string {
  const optional = template.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
    const complete = names.every((n) => props[n] !== undefined && props[n] !== null);
    return complete ? inner : "";
  });
  return optional.replace(/\{(\w+)\}/g, (_m, name: string) => show(props[name]));
}

/** Properties as `{a=1, b=x}`, skipping PostHog's `$` internals. */
export function compactProps(props: Record<string, unknown>): string {
  const parts = Object.entries(props)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => `${k}=${show(v)}`);
  return parts.length ? ` {${parts.join(", ")}}` : "";
}

/** One step as prose. An event outside the table renders as its name plus its properties. */
export function renderStep(step: TrajectoryStep): string {
  const spec = EVENTS[step.event];
  if (!spec) return `${step.event.replace(/_/g, " ")}${compactProps(step.props)}`;
  return fillTemplate(spec.verb, step.props).replace(/\s+/g, " ").trim();
}

export function secondsBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
}

/**
 * The whole trajectory as numbered lines with the delay since the previous step. This is what the
 * synthesis and reward prompts see, and what the console shows under "what they did".
 */
export function renderTrajectory(t: Trajectory): string {
  return renderSteps(t.steps);
}

export function renderSteps(steps: TrajectoryStep[]): string {
  return steps
    .map((s, i) => {
      const prev = steps[i - 1];
      const delta = prev ? ` (+${secondsBetween(prev.t, s.t)}s)` : "";
      return `${i}. ${renderStep(s)}${delta}`;
    })
    .join("\n");
}

/** The last three states, the part OS-Genesis Algorithm 1 shows the reward model. */
export function renderFinalStates(t: Trajectory, count = 3): string {
  const from = Math.max(0, t.steps.length - count);
  return t.steps
    .slice(from)
    .map((s, i) => `step ${from + i} -> ${s.event}${compactProps(s.props)}`)
    .join("\n");
}

/** Steps as `event {props}` lines, the raw form the naming prompt shows for a segment. */
export function renderRaw(steps: TrajectoryStep[]): string {
  return steps.map((s) => `${s.event}${compactProps(s.props)}`).join("\n");
}

/** Manual actions in a step list: the steps a capability call would replace. */
export function countManualActions(steps: TrajectoryStep[]): number {
  return steps.filter((s) => specFor(s.event).role === "action").length;
}

/** The session's own duration in whole seconds, from its first step to its last. */
export function durationSeconds(t: Trajectory): number {
  const first = t.steps[0];
  const last = t.steps[t.steps.length - 1];
  return first && last ? secondsBetween(first.t, last.t) : 0;
}
