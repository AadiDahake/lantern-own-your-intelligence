/**
 * Continuing a walkthrough that is already under way.
 *
 * The user is mid-flow with a caption on their screen and their hand on the mouse, so this path
 * spends nothing it does not have to. The widget only asks when the control it expected is not on
 * the page after a re-scan, so something about the route has changed. The route is recomputed
 * over the site graph from the page as it is now, with no model; only when the graph cannot
 * connect the pages does one small model call read the page and name the steps that are left.
 */
import { EFFORT, MODELS, MAX_ROUTE_STEPS, controlKey, planRoute, validatePlan } from "@lantern/shared";
import type { PageContext, Step } from "@lantern/shared";
import { chatJson } from "../openai";
import { serviceClient } from "../supabase";
import { emitTrace } from "../trace";
import { loadGraph, recordScan } from "../graph/store";
import { currentPageOf } from "./bind";
import { affordanceList, dropRepeats, visibleAffordances } from "./page";
import { bindFirstStep } from "./resolve";

export type ContinueInput = {
  projectId: string;
  conversationId: string;
  question: string;
  page: PageContext;
  /** How many steps of the original plan the user has already completed. */
  continueFrom: number;
};

export type ContinueResult = {
  text: string;
  steps: Step[] | null;
  /** The steps differ from what the user was told, so the widget says so and shows the new count. */
  routeChanged: boolean;
};

const STEPS_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: "string" },
          caption: { type: "string" },
          advanceOn: { type: "string", enum: ["click", "input", "navigation", "manual"] },
        },
        required: ["target", "caption", "advanceOn"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

const SYSTEM = [
  "You are guiding one user through a task on the page they are looking at.",
  "Earlier steps are already done. Return only the steps that are still left, in order.",
  "Each element is listed as `id: role \"name\"`. A step's target is the id, and nothing else: \"a3\", never \"textbox Username\".",
  "Never invent an id.",
  "Every element listed is on the screen right now, so whatever reveals them has already happened.",
  "A control marked (selected) or (expanded) is already active, so it is not a step: skip it.",
  "Start at the first thing the user still has to do themselves.",
  "Use advanceOn 'input' for a field they type into and 'click' for anything they press.",
  "Return an empty list when the task is finished and nothing on this page is left to do.",
  "At most 3 steps. Each caption is at most 12 words and starts with a verb. JSON only.",
].join(" ");

type LastAnswer = { content: string; steps: Step[] | null; grounding: unknown };

/** The answer this walkthrough came from, with whatever it was grounded in. */
async function lastAssistantMessage(conversationId: string): Promise<LastAnswer | null> {
  const { data } = await serviceClient()
    .from("message")
    .select("content, steps, grounding")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    content: String(data.content ?? ""),
    steps: (data.steps as Step[] | null) ?? null,
    grounding: data.grounding ?? null,
  };
}

/** What the user has been told so far, so the continuation does not repeat a step. */
function doneSoFar(previous: LastAnswer, continueFrom: number): string {
  const done = (previous.steps ?? []).slice(0, Math.max(continueFrom, 0));
  if (done.length === 0) return "The user has just started.";
  return `Already done:\n${done.map((step, index) => `${index + 1}. ${step.caption}`).join("\n")}`;
}

/** Whether two step lists walk the same controls in the same order. */
function sameRoute(a: readonly Step[], b: readonly Step[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, index) => {
    const other = b[index];
    if (!step.control || !other?.control) return false;
    return step.control.route === other.control.route && controlKey(step.control) === controlKey(other.control);
  });
}

/**
 * The remaining steps over the graph: from the page as it is now to the target the answer
 * resolved to. Null when the plan carried no target or the graph does not connect the pages.
 */
async function continueOverGraph(input: ContinueInput, previous: LastAnswer): Promise<ContinueResult | null> {
  const last = previous.steps?.[previous.steps.length - 1];
  if (!last?.control) return null;
  // The page the user is on joins the graph first, so a route can start from it.
  await recordScan(input.projectId, input.page, "widget").catch(() => undefined);
  const graph = await loadGraph(input.projectId);
  const target = { route: last.control.route, key: controlKey(last.control) };
  const plan = planRoute(graph, currentPageOf(input.page), target);
  if (!plan) return null;
  if (plan.steps.length === 0) return { text: previous.content, steps: null, routeChanged: false };
  const bound = bindFirstStep(plan.steps, input.page);
  if (!bound) return null;
  const steps = validatePlan(bound, input.page.affordances, MAX_ROUTE_STEPS);
  if (!steps) return null;
  const expected = (previous.steps ?? []).slice(Math.max(input.continueFrom, 0));
  return { text: previous.content, steps, routeChanged: !sameRoute(expected, steps) };
}

/** One small model call over the page as it is now, when the graph has no route to offer. */
async function continueOnPage(input: ContinueInput, previous: LastAnswer): Promise<ContinueResult> {
  const reachableAffordances = visibleAffordances(input.page);
  const grounding = previous.grounding ? JSON.stringify(previous.grounding).slice(0, 4000) : "none";
  const { steps: proposed } = await chatJson<{ steps: Step[] }>(
    MODELS.plan,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Task: ${input.question}`,
          `What we told the user: ${previous.content}`,
          doneSoFar(previous, input.continueFrom),
          `Documentation:\n${grounding}`,
          `Elements on this page now:\n${affordanceList(reachableAffordances)}`,
        ].join("\n\n"),
      },
    ],
    STEPS_SCHEMA,
    { name: "remaining_steps", maxTokens: 3000, effort: EFFORT.plan },
  );

  // One id the model invented should cost that step, not the whole continuation.
  const known = new Set(reachableAffordances.map((affordance) => affordance.id));
  const reachable: Step[] = [];
  for (const step of dropRepeats(proposed ?? [])) {
    if (typeof step.target !== "string" || !known.has(step.target)) break;
    reachable.push(step);
  }
  const steps = validatePlan(reachable, reachableAffordances);
  return { text: previous.content, steps, routeChanged: true };
}

export async function continueGuidance(input: ContinueInput): Promise<ContinueResult> {
  const started = Date.now();
  const previous = await lastAssistantMessage(input.conversationId);
  if (!previous) return { text: "", steps: null, routeChanged: false };

  const overGraph = await continueOverGraph(input, previous).catch(() => null);
  const result = overGraph ?? (await continueOnPage(input, previous));
  const latencyMs = Date.now() - started;
  void emitTrace({
    projectId: input.projectId,
    conversationId: input.conversationId,
    kind: overGraph ? "decision" : "model",
    title: overGraph ? "Re-planned the route over the product map" : "Continued the walkthrough",
    detail: {
      ...(overGraph ? {} : { model: MODELS.plan }),
      purpose: overGraph
        ? "the control the widget expected was not on the page, so the route was recomputed"
        : "the product map has no route from this page, so the page itself was read",
      output_summary: (result.steps ?? []).map((step) => step.caption).join(" / ") || "nothing left",
      routeChanged: result.routeChanged,
      stepsLeft: result.steps?.length ?? 0,
      latencyMs,
    },
    source: "agent",
  });

  return result;
}
