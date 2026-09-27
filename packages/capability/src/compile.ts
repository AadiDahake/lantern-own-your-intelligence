/**
 * The one entry point. Trajectories in, a validated Capability IR out, or a reasoned "none".
 *
 * Four stages, in the order the story is told:
 *   1. user workflows          the sessions, rendered as steps with no model
 *   2. inferred intent         OS-Genesis, arXiv 2412.19723: reverse task synthesis and the reward model
 *   3. semantic capability     ToolCUA, arXiv 2605.12481: granularity; ASIL, arXiv 2608.26991: the IR shape
 *   4. verified implementation the scenarios and final-state checks the Capability Verifier runs
 *
 * Every step records a `CompilerEvent` under its stage, so the console and the terminal view can
 * show the decision as it is made.
 */
import { nameCapability, pickGranularity, rejectedFor, scoreCandidates, type Candidate } from "./granularity";
import { assembleIR } from "./ir";
import { NO_GOAL, reverseTaskSynthesis, type InferredTask } from "./reverse-task-synthesis";
import type {
  CapabilityIR,
  CompileContext,
  CompileOptions,
  CompileResult,
  CompileThresholds,
  CompilerEvent,
  CompilerStage,
  ModelClient,
  Trajectory,
} from "./types";
import { validateCapabilityIR, CapabilityIRError } from "./validate";

export const COMPILER_VERSION = "0.1.0";

export const DEFAULT_THRESHOLDS: CompileThresholds = {
  min_reward_total: 2,
  min_completion: 3,
  min_support: 0.5,
  min_replaces: 3,
  min_sessions: 5,
};

/** The trajectories ToolCUA starts from: successful, and long enough to have a shape. */
export function successfulTasks(tasks: InferredTask[], thresholds: CompileThresholds): InferredTask[] {
  return tasks.filter(
    (t) => t.goal.goal_name !== NO_GOAL && t.reward.completion >= thresholds.min_completion && t.trajectory.steps.length >= 3,
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function candidateSummary(c: Candidate): Record<string, unknown> {
  return {
    name: c.name,
    level: c.level,
    goal: c.goal,
    sessions: c.sessions.length,
    support: Math.round(c.support * 1000) / 1000,
    replaces: c.replaces,
    grounded: c.grounded,
    arguments: c.slots.arguments,
    constants: c.slots.constants,
  };
}

export async function compile(
  trajectories: Trajectory[],
  context: CompileContext,
  model: ModelClient,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const thresholds: CompileThresholds = { ...DEFAULT_THRESHOLDS, ...(context.thresholds ?? {}) };
  const now = options.now ?? (() => new Date());
  const events: CompilerEvent[] = [];
  const emit = (stage: CompilerStage, title: string, detail: Record<string, unknown>): void => {
    const event: CompilerEvent = { stage, title, detail, at: now().toISOString() };
    events.push(event);
    options.onEvent?.(event);
  };

  const steps = trajectories.reduce((n, t) => n + t.steps.length, 0);
  emit("workflows", `${trajectories.length} user workflows, ${steps} steps`, {
    sessions: trajectories.length,
    steps,
    events: countBy(
      trajectories.flatMap((t) => t.steps),
      (s) => s.event,
    ),
    thresholds,
  });

  // Stage 1: OS-Genesis. Goals in order, rewards concurrently, then keep the middle.
  const { kept, dropped } = await reverseTaskSynthesis(trajectories, context, model, thresholds.min_reward_total, {
    concurrency: options.concurrency,
    onGoalBatch: (batch, goals) =>
      emit("intent", `Goals ${batch.index + 1}/${batch.count}: ${goals.length} inferred`, {
        batch: batch.index + 1,
        of: batch.count,
        goals: goals.map((g) => ({ session_id: g.session_id, goal_name: g.goal_name, confidence: g.confidence })),
      }),
    onRewardBatch: (batch, rewards) =>
      emit("intent", `Rewards ${batch.index + 1}/${batch.count}: ${rewards.length} graded`, {
        batch: batch.index + 1,
        of: batch.count,
        grades: rewards.map((r) => ({
          session_id: r.session_id,
          completion: r.completion,
          coherence: r.coherence,
          total: r.total,
        })),
      }),
  });
  const all = [...kept, ...dropped];
  const goals = countBy(all, (t) => t.goal.goal_name);
  const leading = Object.entries(goals)[0];
  const leadingTask = leading ? all.find((t) => t.goal.goal_name === leading[0]) : undefined;
  emit(
    "intent",
    leading && leadingTask ? `Inferred intent: ${leadingTask.goal.goal_sentence || leading[0]} (${leading[1]} sessions)` : "No intent inferred",
    { goals },
  );
  emit("intent", `Scored ${all.length} workflows, ${kept.length} kept (total >= ${thresholds.min_reward_total}), ${dropped.length} dropped`, {
    kept: kept.length,
    dropped: dropped.map((t) => t.trajectory.session_id),
    completion: countBy(all, (t) => String(t.reward.completion)),
    coherence: countBy(all, (t) => String(t.reward.coherence)),
  });

  // Stage 2: ToolCUA. Successful trajectories only, four levels, one pick.
  const ok = successfulTasks(kept, thresholds);
  const candidates = scoreCandidates(ok);
  emit("capability", `${ok.length} successful workflows, ${candidates.length} candidates at 4 levels`, {
    successful: ok.length,
    candidates: candidates.map(candidateSummary),
  });
  const pick = pickGranularity(candidates, thresholds, ok.length);
  const rejected = rejectedFor(candidates, pick.best, thresholds);

  if (!pick.best) {
    emit("capability", "No capability warranted", { reasons: pick.reasons, rejected });
    return { decision: "none", reasons: pick.reasons, rejected, events };
  }
  const best = pick.best;
  const below = [...new Set(rejected.filter((r) => r.level < best.level && r.goal === best.goal).map((r) => r.name))];
  const above = [...new Set(rejected.filter((r) => r.level > best.level && r.goal === best.goal).map((r) => r.name))];
  emit("capability", `Chosen: ${best.name} at level ${best.level}, replaces ${best.replaces} steps, ${Math.round(best.support * 100)}% support`, {
    chosen: candidateSummary(best),
    rejected_too_low: below,
    rejected_too_high: above,
    coverage: best.support,
  });

  // Stage 2, the naming call: one model call that justifies the level against the rejected ones.
  const goalSentence = ok.find((t) => t.goal.goal_name === best.goal)?.goal.goal_sentence ?? best.goal;
  const spec = await nameCapability(context, best, goalSentence, ok.length, rejected, model);
  emit("capability", `Named: ${spec.signature}`, {
    name: spec.name,
    signature: spec.signature,
    description: spec.description,
    arguments: spec.arguments,
    granularity_rationale: spec.granularity_rationale,
    actions: spec.actions,
    proposed_ui: spec.proposed_ui,
  });

  // Stage 3: the IR. Assembled from the data and the spec, then validated; an invalid IR is refused.
  const draft = assembleIR({
    context,
    candidate: best,
    spec,
    tasks: ok,
    rejected,
    model: model.name,
    compiler_version: COMPILER_VERSION,
    created_at: now().toISOString(),
  });
  const checked = validateCapabilityIR(draft);
  if (!checked.ok) {
    emit("capability", "Capability specification refused", { errors: checked.errors });
    throw new CapabilityIRError(checked.errors);
  }
  const ir: CapabilityIR = checked.value;
  emit("capability", `Capability specification v1: ${ir.intent}, ${ir.constraints.length} constraints, ${ir.actions.length} actions (validated)`, {
    intent: ir.intent,
    summary: ir.summary,
    inputs: ir.observation.inputs.map((s) => s.name),
    app_state: ir.observation.app_state.map((s) => s.name),
    interactive_elements: (ir.observation.interactive_elements ?? []).map((e) => e.type),
    actions: ir.actions.map((a) => `${a.kind} ${a.name}`),
    constraints: ir.constraints.map((c) => c.id),
    preferences: (ir.preferences ?? []).map((p) => p.id),
    session_count: ir.evidence.session_count,
    median_manual_actions: ir.evidence.median_manual_actions,
  });
  emit("verification", `${ir.success.scenarios.length} scenarios, ${ir.success.final_state.length} final-state checks`, {
    final_state: ir.success.final_state.map((p) => p.id),
    scenarios: ir.success.scenarios.map((s) => ({ id: s.id, kind: s.kind })),
    kinds: countBy(ir.success.scenarios, (s) => s.kind ?? "unspecified"),
  });
  emit("verification", `Capability ${ir.intent}: ${ir.evidence.session_count} workflows, ${ir.success.scenarios.length} verification scenarios`, {
    intent: ir.intent,
    session_count: ir.evidence.session_count,
    median_manual_actions: ir.evidence.median_manual_actions,
    scenarios: ir.success.scenarios.length,
  });
  return { decision: "capability", ir, rejected, events };
}
