/**
 * Granularity, after ToolCUA (arXiv 2605.12481).
 *
 * ToolCUA synthesises tools "at varying levels of specificity, from single-action wrappers to
 * multi-step composite functions", merges adjacent steps that share a sub-goal bottom-up, anchors
 * every merged tool to a real observed next state, and rewards tools that replace many atomic
 * steps. Its argument semantics are "inferred from the trajectory": a property that varied is an
 * argument, one that never varied is a constant.
 *
 * This file does the same offline: segment every successful trajectory at four levels, cluster
 * the segments that share a shape, score each cluster on support, steps replaced, grounding and
 * argument slots, pick the largest merge that is still grounded and still supported, then make
 * one naming call that sees the rejected candidates below and above it.
 */
import { FAMILY_TOOLS, SESSION_TOOL, specFor } from "./contract";
import { loadPrompt, structuredCall } from "./model";
import { median, sampleWeighted, seededRandom } from "./random";
import { countManualActions, renderRaw } from "./render";
import type { InferredTask } from "./reverse-task-synthesis";
import type {
  CompileContext,
  CompileThresholds,
  JsonSchema,
  ModelClient,
  RejectedCandidate,
  SlotType,
  TrajectoryStep,
} from "./types";

export const PROMPT_TOOL_SYNTH = loadPrompt("tool-synth.md");

/** Level 0 is one step per segment; each level above merges further. */
export const LEVELS = 4;

export const LEVEL_NAMES = ["single action", "sub-goal run", "open-to-commit window", "whole session"] as const;

export type Segment = {
  session_id: string;
  goal: string;
  level: number;
  /** The shape this segment has at its level: an event, a family, a window or the session. */
  key: string;
  steps: TrajectoryStep[];
  /** The trajectory's reward total, the weight when sampling exemplars. */
  weight: number;
};

export type ArgSlots = {
  /** Properties that took more than one value across the segments, each with one type. */
  arguments: string[];
  /** Properties that never changed. Baked into the implementation, not passed to it. */
  constants: string[];
  types: Record<string, SlotType>;
  values: Record<string, unknown[]>;
};

export type Candidate = {
  name: string;
  level: number;
  goal: string;
  key: string;
  segments: Segment[];
  sessions: string[];
  /** Share of the successful trajectories this candidate explains. */
  support: number;
  /** Median manual steps one call replaces. ToolCUA's length reward, offline. */
  replaces: number;
  /** Every segment ends in one observed committed state. Merging past that loses grounding. */
  grounded: boolean;
  slots: ArgSlots;
};

const NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/* ------------------------------------------------------------------------------------------- */
/* 1. Segment                                                                                   */
/* ------------------------------------------------------------------------------------------- */

function make(task: InferredTask, level: number, key: string, steps: TrajectoryStep[]): Segment {
  return {
    session_id: task.trajectory.session_id,
    goal: task.goal.goal_name,
    level,
    key,
    steps,
    weight: task.reward.total,
  };
}

/** Level 1: adjacent steps of the same family become one segment. */
function familyRuns(steps: TrajectoryStep[]): TrajectoryStep[][] {
  const runs: TrajectoryStep[][] = [];
  for (const step of steps) {
    const last = runs[runs.length - 1];
    if (last && specFor((last[0] as TrajectoryStep).event).family === specFor(step.event).family) last.push(step);
    else runs.push([step]);
  }
  return runs;
}

/** Level 2: from a `start` step to the next `end` step, inclusive. Steps outside a window belong to none. */
function windows(steps: TrajectoryStep[]): TrajectoryStep[][] {
  const out: TrajectoryStep[][] = [];
  let open: TrajectoryStep[] | null = null;
  let orphan: TrajectoryStep[] = [];
  for (const step of steps) {
    const role = specFor(step.event).role;
    if (role === "start") {
      open = [step];
      orphan = [];
    } else if (role === "end") {
      out.push(open ? [...open, step] : [...orphan, step]);
      open = null;
      orphan = [];
    } else if (open) {
      open.push(step);
    } else {
      orphan.push(step);
    }
  }
  return out;
}

export function segment(task: InferredTask, level: number): Segment[] {
  const steps = task.trajectory.steps;
  switch (level) {
    case 0:
      return steps.map((s) => make(task, 0, s.event, [s]));
    case 1:
      return familyRuns(steps).map((run) => make(task, 1, specFor((run[0] as TrajectoryStep).event).family, run));
    case 2:
      return windows(steps).map((w) => make(task, 2, "window", w));
    default:
      return [make(task, 3, "session", steps)];
  }
}

/* ------------------------------------------------------------------------------------------- */
/* 2. Cluster and score                                                                         */
/* ------------------------------------------------------------------------------------------- */

/** Segments with the same goal, level and shape are one candidate tool. */
export function cluster(segments: Segment[]): Map<string, Segment[]> {
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    const id = `${s.goal}|${s.level}|${s.key}`;
    const list = groups.get(id);
    if (list) list.push(s);
    else groups.set(id, [s]);
  }
  return groups;
}

/**
 * Next-state grounding. A segment is anchored to one observed effect when it contains at most one
 * committing step and, if it has one, that step is its last. Merging past a commit, or across two,
 * claims an effect no single observed state shows.
 */
export function isGrounded(segment: Segment): boolean {
  const ends = segment.steps.filter((s) => specFor(s.event).role === "end");
  if (ends.length === 0) return true;
  if (ends.length > 1) return false;
  const last = segment.steps[segment.steps.length - 1] as TrajectoryStep;
  return specFor(last.event).role === "end";
}

function typeOf(value: unknown): SlotType | null {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return "string[]";
    if (value.every((v) => typeof v === "number")) return "number[]";
    return "object[]";
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "object":
      return value === null ? null : "object";
    default:
      return null;
  }
}

/**
 * Argument semantics inferred from the data. A property that changes across the segments but
 * keeps one type is an argument. A property that never changes is a constant, not an argument.
 * A property whose type changes is neither: it is not a slot at all.
 */
export function ARG_SLOTS(segments: Segment[]): ArgSlots {
  const seen = new Map<string, Map<string, unknown>>();
  const kinds = new Map<string, Set<string>>();
  for (const seg of segments) {
    for (const step of seg.steps) {
      for (const [key, value] of Object.entries(step.props)) {
        if (!NAME.test(key) || value === null || value === undefined) continue;
        const type = typeOf(value);
        if (!type) continue;
        const values = seen.get(key) ?? new Map<string, unknown>();
        values.set(JSON.stringify(value), value);
        seen.set(key, values);
        const k = kinds.get(key) ?? new Set<string>();
        k.add(type === "integer" ? "number" : type);
        kinds.set(key, k);
      }
    }
  }
  const out: ArgSlots = { arguments: [], constants: [], types: {}, values: {} };
  for (const [key, values] of seen) {
    const list = [...values.values()];
    const kind = kinds.get(key) as Set<string>;
    if (kind.size !== 1) continue;
    const type = [...kind][0] as SlotType;
    out.types[key] =
      type === "number" && list.every((v) => Number.isInteger(v)) ? "integer" : type;
    out.values[key] = list;
    if (list.length > 1) out.arguments.push(key);
    else out.constants.push(key);
  }
  out.arguments.sort();
  out.constants.sort();
  return out;
}

export function candidateName(level: number, key: string, goal: string): string {
  if (level === 0) return specFor(key).wrapper;
  if (level === 1) return FAMILY_TOOLS[key as keyof typeof FAMILY_TOOLS] ?? key;
  if (level === 2) return goal;
  return SESSION_TOOL;
}

/** Every candidate at every level, scored. `tasks` must already be the successful ones. */
export function scoreCandidates(tasks: InferredTask[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (let level = 0; level < LEVELS; level++) {
    const segments = tasks.flatMap((t) => segment(t, level));
    for (const group of cluster(segments).values()) {
      const first = group[0] as Segment;
      const sessions = [...new Set(group.map((s) => s.session_id))];
      candidates.push({
        name: candidateName(level, first.key, first.goal),
        level,
        goal: first.goal,
        key: first.key,
        segments: group,
        sessions,
        support: tasks.length === 0 ? 0 : sessions.length / tasks.length,
        replaces: median(group.map((s) => countManualActions(s.steps))),
        grounded: group.every(isGrounded),
        slots: ARG_SLOTS(group),
      });
    }
  }
  return candidates.sort((a, b) => b.replaces - a.replaces || b.support - a.support || a.level - b.level);
}

/* ------------------------------------------------------------------------------------------- */
/* 3. Pick                                                                                      */
/* ------------------------------------------------------------------------------------------- */

export type Pick = { best: Candidate | null; viable: Candidate[]; reasons: string[] };

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * The largest merge that is still grounded, still supported by half the sessions, still has an
 * argument, and still replaces enough steps to be worth a call. When nothing qualifies the
 * reasons say which floor each best attempt missed: that is the "no capability warranted" answer,
 * which ToolCUA's tool reward makes as important as finding one.
 */
export function pickGranularity(
  candidates: Candidate[],
  thresholds: CompileThresholds,
  successfulSessions: number,
): Pick {
  const reasons: string[] = [];
  if (successfulSessions < thresholds.min_sessions) {
    reasons.push(
      `Only ${successfulSessions} successful session${successfulSessions === 1 ? "" : "s"}; the floor is ${thresholds.min_sessions}. One workaround is an anecdote, not a specification.`,
    );
  }
  const viable = candidates.filter(
    (c) =>
      c.grounded &&
      c.support >= thresholds.min_support &&
      c.slots.arguments.length >= 1 &&
      c.replaces >= thresholds.min_replaces,
  );
  const best = viable[0] ?? null;
  if (!best) {
    const supported = candidates.filter((c) => c.grounded && c.support >= thresholds.min_support && c.slots.arguments.length >= 1);
    const top = supported[0];
    if (top) {
      reasons.push(
        `The largest supported candidate, ${top.name}, replaces a median of ${top.replaces} manual step${top.replaces === 1 ? "" : "s"}; the floor is ${thresholds.min_replaces}.`,
      );
    }
    const big = candidates.find((c) => c.replaces >= thresholds.min_replaces && c.grounded && c.support < thresholds.min_support);
    if (big) {
      reasons.push(
        `${big.name} would replace ${big.replaces} steps but only ${pct(big.support)} of the sessions share it; the floor is ${pct(thresholds.min_support)}.`,
      );
    }
    const unanchored = candidates.find((c) => c.replaces >= thresholds.min_replaces && !c.grounded);
    if (unanchored) reasons.push(`${unanchored.name} is not grounded in one observed end state.`);
    if (candidates.length === 0) reasons.push("No successful trajectory had three or more steps.");
  }
  return { best: reasons.length > 0 ? null : best, viable, reasons };
}

/** Why each other candidate lost, for the trail and the naming prompt. */
export function rejectedFor(candidates: Candidate[], best: Candidate | null, thresholds: CompileThresholds): RejectedCandidate[] {
  return candidates
    .filter((c) => c !== best)
    .map((c) => {
      let reason: string;
      if (!c.grounded) reason = "not grounded in one observed end state";
      else if (c.support < thresholds.min_support) reason = `support ${pct(c.support)}, below ${pct(thresholds.min_support)}`;
      else if (c.slots.arguments.length === 0) reason = "nothing varied, so there is nothing to pass";
      else if (best && c.level < best.level) reason = `too small: replaces ${c.replaces} step${c.replaces === 1 ? "" : "s"}`;
      else if (best && c.level > best.level) reason = "same effect at a larger merge";
      else if (c.replaces < thresholds.min_replaces) reason = `replaces ${c.replaces} steps, below ${thresholds.min_replaces}`;
      else reason = `replaces ${c.replaces} steps, fewer than the winner`;
      return {
        name: c.name,
        level: c.level,
        goal: c.goal,
        sessions: c.sessions.length,
        support: c.support,
        replaces: c.replaces,
        grounded: c.grounded,
        arguments: c.slots.arguments,
        reason,
      };
    });
}

/* ------------------------------------------------------------------------------------------- */
/* 4. Name                                                                                      */
/* ------------------------------------------------------------------------------------------- */

export type ToolArgument = {
  name: string;
  type: "string" | "number" | "boolean" | "object[]" | "string[]";
  description: string;
};

export type ToolAction = {
  name: string;
  kind: "read" | "write" | "rank";
  action_type: "set_value" | "invoke_function" | "modify_file" | "api_call" | "navigate" | "batch";
  target: string;
  description: string;
  parameters: string[];
};

export type ToolSpec = {
  name: string;
  signature: string;
  description: string;
  arguments: ToolArgument[];
  granularity_rationale: string;
  summary: string;
  actions: ToolAction[];
  proposed_ui: {
    location: string;
    label: string;
    affordance: "button" | "menu_item" | "inline_panel" | "modal" | "toolbar_action";
    result_summary: string;
  };
};

export const TOOL_SYNTH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name", "signature", "description", "arguments", "granularity_rationale", "summary", "actions", "proposed_ui"],
  additionalProperties: false,
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9_]{2,63}$" },
    signature: { type: "string" },
    description: { type: "string", maxLength: 240 },
    arguments: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" },
          type: { enum: ["string", "number", "boolean", "object[]", "string[]"] },
          description: { type: "string" },
        },
      },
    },
    granularity_rationale: { type: "string", maxLength: 200 },
    summary: { type: "string", maxLength: 280 },
    actions: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "kind", "action_type", "target", "description", "parameters"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" },
          kind: { enum: ["read", "write", "rank"] },
          action_type: { type: "string", enum: ["set_value", "invoke_function", "modify_file", "api_call", "navigate", "batch"] },
          target: { type: "string" },
          description: { type: "string" },
          parameters: { type: "array", items: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" } },
        },
      },
    },
    proposed_ui: {
      type: "object",
      required: ["location", "label", "affordance", "result_summary"],
      additionalProperties: false,
      properties: {
        location: { type: "string" },
        label: { type: "string" },
        affordance: { type: "string", enum: ["button", "menu_item", "inline_panel", "modal", "toolbar_action"] },
        result_summary: { type: "string" },
      },
    },
  },
};

/** The exemplars the naming prompt shows: reward-weighted sampling, seeded, so the same input gives the same prompt. */
export function exemplarsOf(candidate: Candidate, count = 2): Segment[] {
  return sampleWeighted(candidate.segments, (s) => s.weight, count, seededRandom(7));
}

export function buildToolSynthUser(
  context: CompileContext,
  candidate: Candidate,
  goalSentence: string,
  successfulSessions: number,
  rejected: RejectedCandidate[],
): string {
  const below = rejected.filter((r) => r.level < candidate.level && r.goal === candidate.goal);
  const above = rejected.filter((r) => r.level > candidate.level && r.goal === candidate.goal);
  const list = (rs: RejectedCandidate[]): string =>
    rs.length === 0
      ? "none"
      : [...new Map(rs.map((r) => [r.name, r])).values()]
          .map((r) => `${r.name} (replaces ${r.replaces}, ${r.reason})`)
          .join("; ");
  const exemplars = exemplarsOf(candidate)
    .map(
      (s) =>
        `Representative segment (session ${s.session_id}, reward ${s.weight}/5):\n${renderRaw(s.steps)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}`,
    )
    .join("\n\n");
  return [
    `Product: ${context.product}.`,
    `Page: ${context.page}.`,
    `Sessions explaining this pattern: ${candidate.sessions.length} of ${successfulSessions} (${pct(candidate.support)}).`,
    `Median manual steps replaced: ${candidate.replaces}.`,
    `Inferred goal (reverse task synthesis): ${goalSentence} (${candidate.goal}).`,
    "",
    exemplars,
    "",
    `Properties that varied across sessions: ${candidate.slots.arguments.join(", ") || "none"}`,
    `Properties that never varied: ${candidate.slots.constants.join(", ") || "none"}`,
    "",
    `Rejected, one level down (too small): ${list(below)}`,
    `Rejected, one level up (not grounded in any single end state): ${list(above)}`,
    "",
    "Return the capability name, signature, description, argument list, one sentence on why this level of granularity and not the rejected ones, a summary, the actions it composes, and the proposed UI.",
  ].join("\n");
}

/** One model call that names and signs the winner, justifying the level against the rejected ones. */
export async function nameCapability(
  context: CompileContext,
  candidate: Candidate,
  goalSentence: string,
  successfulSessions: number,
  rejected: RejectedCandidate[],
  model: ModelClient,
): Promise<ToolSpec> {
  const user = buildToolSynthUser(context, candidate, goalSentence, successfulSessions, rejected);
  return structuredCall<ToolSpec>(model, { purpose: "tool_synth", system: PROMPT_TOOL_SYNTH, user }, TOOL_SYNTH_SCHEMA);
}
