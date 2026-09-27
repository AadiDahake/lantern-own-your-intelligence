/**
 * Steps 4 to 7 of the evidence loop: the capability compiler, driven from the app.
 *
 * The compiler is pure and takes an injected model; this file supplies the model, writes every
 * line of its decision trail as a `capability` trace row in order, stores the validated IR as the
 * next version of the group's specification, and records the per-session goals and rewards on
 * the trajectory rows. Model output never touches the database unvalidated: the IR that arrives
 * here already passed the compiler's schema.
 */
import {
  compile,
  type CapabilityIR,
  type CompileContext,
  type CompilerEvent,
  type ModelClient,
  type Trajectory,
} from "@lantern/capability";
import type { OpportunityStore, TrajectoryScore } from "./store";

export type CompileOutcome =
  | {
      decision: "capability";
      ir: CapabilityIR;
      specId: string;
      version: number;
      medianInteractions: number | null;
      events: CompilerEvent[];
    }
  | { decision: "none"; reasons: string[]; events: CompilerEvent[] };

export type CompileInput = {
  trajectories: Trajectory[];
  context: CompileContext;
  model: ModelClient;
  store: OpportunityStore;
  /** Reward batches in flight at once. The synthesis batches always run in order. */
  concurrency?: number;
  now?: () => Date;
};

export const COMMIT_EVENT = "seat_assignment_confirmed";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The product's own interaction count, by median over the supporting sessions. NovaAir writes
 * `interactions` on the committing event: seat clicks, refused clicks and passenger picks. This
 * is the number the outcome row compares against, because the outcome events count the same way.
 */
export function medianInteractions(ir: CapabilityIR): number | null {
  const counts: number[] = [];
  for (const trajectory of ir.evidence.trajectories) {
    const commit = [...trajectory.steps].reverse().find((step) => step.event === COMMIT_EVENT);
    const value = Number(commit?.props?.interactions);
    if (Number.isFinite(value)) counts.push(value);
  }
  return median(counts);
}

type GoalEntry = { session_id: string; goal_name: string; confidence: number };
type GradeEntry = { session_id: string; completion: number; coherence: number; total: number };

const INTENT_TITLE = /^Inferred intent: (.+) \(\d+ sessions?\)$/;

/**
 * The per-session goals and rewards, read back from the decision trail. The leading goal's
 * sentence comes from the intent event; every other goal keeps its name only.
 */
export function scoresFromEvents(events: CompilerEvent[]): TrajectoryScore[] {
  const goals = new Map<string, GoalEntry>();
  const grades = new Map<string, GradeEntry>();
  let leadingSentence: string | null = null;
  let leadingName: string | null = null;

  for (const event of events) {
    if (event.stage !== "intent") continue;
    const detail = event.detail;
    if (Array.isArray(detail.goals)) {
      for (const raw of detail.goals as unknown[]) {
        const goal = raw as Partial<GoalEntry>;
        if (typeof goal.session_id === "string" && typeof goal.goal_name === "string") {
          goals.set(goal.session_id, {
            session_id: goal.session_id,
            goal_name: goal.goal_name,
            confidence: typeof goal.confidence === "number" ? goal.confidence : 0,
          });
        }
      }
    }
    if (Array.isArray(detail.grades)) {
      for (const raw of detail.grades as unknown[]) {
        const grade = raw as Partial<GradeEntry>;
        if (typeof grade.session_id === "string") {
          grades.set(grade.session_id, {
            session_id: grade.session_id,
            completion: Number(grade.completion ?? 0),
            coherence: Number(grade.coherence ?? 0),
            total: Number(grade.total ?? 0),
          });
        }
      }
    }
    const match = INTENT_TITLE.exec(event.title);
    if (match && detail.goals && !Array.isArray(detail.goals)) {
      leadingSentence = match[1] ?? null;
      const counted = detail.goals as Record<string, number>;
      leadingName = Object.keys(counted)[0] ?? null;
    }
  }

  const sessions = new Set([...goals.keys(), ...grades.keys()]);
  return [...sessions].map((sessionId) => {
    const goal = goals.get(sessionId);
    const grade = grades.get(sessionId);
    return {
      sessionId,
      goalName: goal?.goal_name ?? null,
      goalConfidence: goal?.confidence ?? null,
      inferredGoal: goal && goal.goal_name === leadingName ? leadingSentence : null,
      rewardCompletion: grade?.completion ?? null,
      rewardCoherence: grade?.coherence ?? null,
    };
  });
}

/** Runs the compiler and stores what it decided. Throws when the IR is refused or a model call fails. */
export async function compileOpportunity(input: CompileInput): Promise<CompileOutcome> {
  const { store } = input;
  // Trace rows are appended in the order the compiler emitted them: one chain, awaited at the end.
  let chain: Promise<void> = Promise.resolve();
  const onEvent = (event: CompilerEvent): void => {
    chain = chain.then(() =>
      store.trace({
        kind: "capability",
        status: event.title.startsWith("No capability") || event.title.startsWith("Capability specification refused") ? "failed" : "ok",
        title: event.title,
        detail: event,
      }),
    );
  };

  let result: Awaited<ReturnType<typeof compile>>;
  try {
    result = await compile(input.trajectories, input.context, input.model, {
      onEvent,
      concurrency: input.concurrency ?? 3,
      now: input.now,
    });
  } finally {
    await chain;
  }

  await store.scoreTrajectories(scoresFromEvents(result.events));

  if (result.decision === "none") {
    return { decision: "none", reasons: result.reasons, events: result.events };
  }

  const { ir } = result;
  const interactions = medianInteractions(ir);
  const stored = await store.insertSpec({ ir, model: input.model.name, medianInteractions: interactions });
  await store.trace({
    kind: "artifact",
    status: "ok",
    title: `Capability specification v${stored.version}: ${ir.intent}`,
    detail: {
      artifact: "capability_spec",
      id: stored.id,
      version: stored.version,
      intent: ir.intent,
      summary: ir.summary ?? null,
      session_count: ir.evidence.session_count,
      median_manual_actions: ir.evidence.median_manual_actions ?? null,
      median_interactions: interactions,
      scenarios: ir.success.scenarios.length,
      constraints: ir.constraints.length,
      actions: ir.actions.map((action) => action.name),
      opportunity_id: input.context.opportunity_id ?? null,
    },
  });
  await store.trace({
    kind: "decision",
    status: "ok",
    title: `missing_capability.discovered: ${ir.intent}`,
    detail: {
      event: "missing_capability.discovered",
      intent: ir.intent,
      capability_spec_id: stored.id,
      sessions: ir.evidence.session_count,
      scenarios: ir.success.scenarios.length,
    },
  });
  return {
    decision: "capability",
    ir,
    specId: stored.id,
    version: stored.version,
    medianInteractions: interactions,
    events: result.events,
  };
}
