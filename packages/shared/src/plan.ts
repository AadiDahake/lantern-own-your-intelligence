import type { Affordance, Step } from "./types";

/** Captions have to fit a bubble beside a control and be read aloud in one breath. */
const MAX_CAPTION_WORDS = 14;

/** Beyond this a guided walkthrough stops being guidance. */
const MAX_STEPS = 5;

const ADVANCE_ON = new Set<Step["advanceOn"]>(["click", "input", "navigation", "manual"]);

/**
 * Checks a model-produced step plan against the affordances the widget actually sent.
 *
 * Model output is untrusted, and a step whose target does not exist would spotlight nothing, so
 * one bad step rejects the whole plan: the caller keeps the prose and drops the guidance rather
 * than walking the user through a partly imaginary interface.
 */
export function validatePlan(
  steps: readonly Step[],
  affordances: readonly Affordance[],
  maxSteps: number = MAX_STEPS,
): Step[] | null {
  if (steps.length === 0 || steps.length > maxSteps) return null;

  const known = new Set(affordances.map((affordance) => affordance.id));
  const validated: Step[] = [];

  for (const [index, step] of steps.entries()) {
    if (!step) return null;
    // A step on a later page has no live id yet; it must at least say which control it is. The
    // first step is what the spotlight draws now, so it always needs a live id.
    if (step.target === null) {
      if (index === 0 || !isControl(step.control)) return null;
    } else if (typeof step.target !== "string" || !known.has(step.target)) {
      return null;
    }
    if (typeof step.caption !== "string") return null;

    const caption = step.caption.trim();
    if (caption.length === 0) return null;
    if (caption.split(/\s+/).length > MAX_CAPTION_WORDS) return null;

    if (!ADVANCE_ON.has(step.advanceOn)) return null;

    const kept: Step = { target: step.target, caption, advanceOn: step.advanceOn };
    if (isControl(step.control)) kept.control = step.control;
    validated.push(kept);
  }

  return validated;
}

function isControl(value: unknown): value is NonNullable<Step["control"]> {
  if (typeof value !== "object" || value === null) return false;
  const control = value as Record<string, unknown>;
  return (
    typeof control.role === "string" &&
    typeof control.name === "string" &&
    control.name.trim() !== "" &&
    typeof control.route === "string" &&
    control.route !== ""
  );
}
