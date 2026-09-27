/**
 * Reverse task synthesis and the trajectory reward model, after OS-Genesis (arXiv 2412.19723).
 *
 * The paper explores a GUI to manufacture trajectories, then writes the task afterwards:
 * `f_low` turns each step into a low-level instruction, `f_high` lifts a sequence to the goal it
 * serves, and a trajectory reward model grades each result on completion and coherence, 1 to 5,
 * as a sampling weight rather than a cutoff. Lantern already has real trajectories, so only the
 * second half is needed: `render.ts` is `f_low` with no model, this file is `f_high` and the
 * reward model, batched eight sessions per call through the injected `ModelClient`.
 */
import { chunk, loadPrompt, mapWithConcurrency, structuredCall } from "./model";
import { renderFinalStates, renderTrajectory } from "./render";
import type { CompileContext, JsonSchema, ModelClient, Trajectory } from "./types";

export const PROMPT_F_HIGH = loadPrompt("f-high.md");
export const PROMPT_TRM = loadPrompt("trm.md");

/** Sessions per model call. Small enough for one reply, large enough to amortise the prompt. */
export const BATCH_SIZE = 8;

export type InferredGoal = {
  session_id: string;
  goal_sentence: string;
  goal_name: string;
  confidence: number;
};

/** Both axes kept separate. `total` is the paper's single reward, used as a sampling weight. */
export type TrajectoryReward = {
  completion: number;
  coherence: number;
  total: number;
  why: string;
};

export type InferredTask = {
  trajectory: Trajectory;
  rendered: string;
  goal: InferredGoal;
  reward: TrajectoryReward;
};

export const NO_GOAL = "no_coherent_goal";

/** Output of `f_high`. An object root, which every structured-output provider accepts. */
export const F_HIGH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["sessions"],
  additionalProperties: false,
  properties: {
    sessions: {
      type: "array",
      items: {
        type: "object",
        required: ["session_id", "goal_sentence", "goal_name", "confidence"],
        additionalProperties: false,
        properties: {
          session_id: { type: "string" },
          goal_sentence: { type: "string", maxLength: 140 },
          goal_name: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

/** Output of the reward model: two axes and the total, each 1 to 5, never averaged here. */
export const TRM_SCHEMA: JsonSchema = {
  type: "object",
  required: ["grades"],
  additionalProperties: false,
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        required: ["session_id", "completion", "coherence", "total", "why"],
        additionalProperties: false,
        properties: {
          session_id: { type: "string" },
          completion: { type: "integer", minimum: 1, maximum: 5 },
          coherence: { type: "integer", minimum: 1, maximum: 5 },
          total: { type: "integer", minimum: 1, maximum: 5 },
          why: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

function header(context: CompileContext): string {
  return `Product: ${context.product}.\nPage: ${context.page}.`;
}

function sessionHeading(t: Trajectory): string {
  return `Session ${t.session_id} (${t.steps.length} steps, ${t.duration_seconds} seconds)`;
}

/** The user message of one `f_high` batch. `vocabulary` is the goal names earlier batches used. */
export function buildFHighUser(context: CompileContext, batch: Trajectory[], vocabulary: string[]): string {
  const sessions = batch.map((t) => `${sessionHeading(t)}:\n${renderTrajectory(t)}`).join("\n\n");
  const known =
    vocabulary.length > 0
      ? `\n\nGoal names already in use: ${vocabulary.join(", ")}. Reuse one when the goal is the same.`
      : "";
  return `${header(context)}\n\n${sessions}${known}\n\nFor each session return: session_id, goal_sentence, goal_name, confidence.`;
}

/** The user message of one reward batch: the goal, every low-level step, and the last three states. */
export function buildTrmUser(
  context: CompileContext,
  batch: Array<{ trajectory: Trajectory; goal: InferredGoal }>,
): string {
  const sessions = batch
    .map(({ trajectory, goal }) => {
      const stated = goal.goal_name === NO_GOAL ? "none stated (no coherent goal was found)" : goal.goal_sentence;
      return [
        `${sessionHeading(trajectory)}`,
        `Inferred goal: ${stated}`,
        "Low-level steps:",
        renderTrajectory(trajectory)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
        "Final three states:",
        renderFinalStates(trajectory)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      ].join("\n");
    })
    .join("\n\n");
  return `${header(context)}\n\n${sessions}\n\nFor each session return: session_id, completion, coherence, total, why.`;
}

export type SynthesisBatch = { index: number; count: number; session_ids: string[] };

export type SynthesisOptions = {
  concurrency?: number;
  onGoalBatch?: (batch: SynthesisBatch, goals: InferredGoal[]) => void;
  onRewardBatch?: (batch: SynthesisBatch, rewards: Array<TrajectoryReward & { session_id: string }>) => void;
};

/**
 * `f_high` over every trajectory, eight per call, in order. Each call sees the goal names the
 * earlier calls produced, so one goal keeps one name across the whole set. A session the model
 * leaves out is recorded as having no coherent goal rather than guessed.
 */
export async function inferGoals(
  trajectories: Trajectory[],
  context: CompileContext,
  model: ModelClient,
  options: SynthesisOptions = {},
): Promise<Map<string, InferredGoal>> {
  const goals = new Map<string, InferredGoal>();
  const vocabulary: string[] = [];
  const batches = chunk(trajectories, BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const user = buildFHighUser(context, batch, vocabulary);
    const out = await structuredCall<{ sessions: InferredGoal[] }>(
      model,
      { purpose: "f_high", system: PROMPT_F_HIGH, user },
      F_HIGH_SCHEMA,
    );
    const byId = new Map(out.sessions.map((s) => [s.session_id, s]));
    const produced: InferredGoal[] = [];
    for (const t of batch) {
      const goal = byId.get(t.session_id) ?? {
        session_id: t.session_id,
        goal_sentence: "",
        goal_name: NO_GOAL,
        confidence: 0,
      };
      goals.set(t.session_id, goal);
      produced.push(goal);
      if (goal.goal_name !== NO_GOAL && !vocabulary.includes(goal.goal_name)) vocabulary.push(goal.goal_name);
    }
    options.onGoalBatch?.({ index, count: batches.length, session_ids: batch.map((t) => t.session_id) }, produced);
  }
  return goals;
}

/**
 * The trajectory reward model over every trajectory, eight per call. Batches are independent, so
 * they run with the caller's concurrency. A missing grade is the lowest one, not a guess.
 */
export async function scoreTrajectories(
  trajectories: Trajectory[],
  goals: Map<string, InferredGoal>,
  context: CompileContext,
  model: ModelClient,
  options: SynthesisOptions = {},
): Promise<Map<string, TrajectoryReward>> {
  const rewards = new Map<string, TrajectoryReward>();
  const batches = chunk(trajectories, BATCH_SIZE);
  await mapWithConcurrency(batches, options.concurrency ?? 4, async (batch, index) => {
    const items = batch.map((trajectory) => ({
      trajectory,
      goal: goals.get(trajectory.session_id) ?? {
        session_id: trajectory.session_id,
        goal_sentence: "",
        goal_name: NO_GOAL,
        confidence: 0,
      },
    }));
    const out = await structuredCall<{ grades: Array<TrajectoryReward & { session_id: string }> }>(
      model,
      { purpose: "trm", system: PROMPT_TRM, user: buildTrmUser(context, items) },
      TRM_SCHEMA,
    );
    const byId = new Map(out.grades.map((g) => [g.session_id, g]));
    const produced: Array<TrajectoryReward & { session_id: string }> = [];
    for (const t of batch) {
      const grade = byId.get(t.session_id) ?? {
        session_id: t.session_id,
        completion: 1,
        coherence: 1,
        total: 1,
        why: "The reward model returned no grade for this session.",
      };
      rewards.set(t.session_id, {
        completion: grade.completion,
        coherence: grade.coherence,
        total: grade.total,
        why: grade.why,
      });
      produced.push(grade);
    }
    options.onRewardBatch?.({ index, count: batches.length, session_ids: batch.map((t) => t.session_id) }, produced);
  });
  return rewards;
}

/**
 * The whole stage: goals, then rewards, then the OS-Genesis keep rule. Trajectories with a total
 * below `minTotal` are dropped; everything else is kept with its weight, including the middle.
 */
export async function reverseTaskSynthesis(
  trajectories: Trajectory[],
  context: CompileContext,
  model: ModelClient,
  minTotal: number,
  options: SynthesisOptions = {},
): Promise<{ kept: InferredTask[]; dropped: InferredTask[] }> {
  const goals = await inferGoals(trajectories, context, model, options);
  const rewards = await scoreTrajectories(trajectories, goals, context, model, options);
  const tasks: InferredTask[] = trajectories.map((trajectory) => ({
    trajectory,
    rendered: renderTrajectory(trajectory),
    goal: goals.get(trajectory.session_id) as InferredGoal,
    reward: rewards.get(trajectory.session_id) as TrajectoryReward,
  }));
  return {
    kept: tasks.filter((t) => t.reward.total >= minTotal),
    dropped: tasks.filter((t) => t.reward.total < minTotal),
  };
}
