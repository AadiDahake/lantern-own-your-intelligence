/**
 * One chat turn: read the message, route on what kind of message it is, and only then check
 * anything.
 *
 * Not every message is a support request. A greeting, a question about the assistant and a piece
 * of general knowledge are answered from the model; a question the page already answers is
 * answered from that page. Neither runs a check and neither offers to report anything, because
 * there is nothing missing to report. Only a question about what the product can do runs the
 * three checks, the verdict and the absence path (`understand.ts`).
 *
 * A question that resolved before answers from the site graph with one model call. A new question
 * resolves to one control on the site; the route to it is read off the graph, so the number of
 * steps the widget announces is the number the walk takes.
 */
import { EFFORT, MODELS, MAX_ROUTE_STEPS, planRoute, routeProbes, validatePlan } from "@lantern/shared";
import type {
  AnswerSource,
  ChatEvent,
  EscalationOffer,
  FeatureRequest,
  PageContext,
  PlanSummary,
  ProbeResult,
  Step,
  Verdict,
} from "@lantern/shared";
import { chatJson, embed } from "../openai";
import { serviceClient } from "../supabase";
import { emitTrace } from "../trace";
import {
  findKnownRoute,
  intentKey,
  loadGraph,
  nearestKnownRoute,
  recordScan,
  saveKnownRoute,
  touchKnownRoute,
  type KnownRoute,
  type StoredGraph,
} from "../graph/store";
import { mapWithCurrentPage } from "../graph/live";
import { belongsToSite } from "../graph/origin";
import { recallRoute, rememberedAsKnown } from "../routes/provider";
import { currentPageOf } from "./bind";
import { answerChat, answerFromPage, answerFromPassage } from "./direct";
import { loadVisitorFacts, rememberFromTurn } from "./memory";
import { affordanceList, dropRepeats } from "./page";
import { triggerDiscovery } from "../opportunity/queue";
import { DOCS_SURE_MISS, probeCapabilities, probeDocs, probeInterface, type DocsEvidence } from "./probes";
import { noteRequest } from "./requests";
import {
  bindFirstStep,
  candidatesFor,
  controlsOnThisPage,
  planEndsOnCapability,
  resolveTarget,
} from "./resolve";
import { closeConversation } from "./summary";
import { understand } from "./understand";

/**
 * What the widget is told about reporting.
 *
 * A drafted request with no repository to file it against is not an offer: the widget says so
 * instead of showing a button that would come back with an error.
 */
function escalationOffer(request: FeatureRequest | null, repoFullName: string | null): EscalationOffer {
  if (!request) return { offered: false };
  return repoFullName ? { offered: true, request } : { offered: false, reason: "no_repository" };
}

/**
 * The repository this project files against, from the project row itself.
 *
 * "The team has not connected a repository yet" is a claim about the customer, not about this
 * request, and the widget shows it as a fact. So it is only ever made from the binding the project
 * carries: a turn started without the name, or with an empty one, reads it rather than assuming
 * there is none. The read costs one round trip and only happens on the paths that draft a request.
 */
async function boundRepository(projectId: string, named: string | null): Promise<string | null> {
  const hinted = named?.trim();

  if (hinted) return hinted;
  const { data } = await serviceClient()
    .from("project")
    .select("repo_full_name")
    .eq("id", projectId)
    .maybeSingle();
  const bound = (data as { repo_full_name?: unknown } | null)?.repo_full_name;
  return typeof bound === "string" && bound.trim() ? bound.trim() : null;
}

export type TurnInput = {
  projectId: string;
  repoFullName: string | null;
  defaultBranch: string;
  /**
   * Where this project's site lives. A page from any other origin answers the question but never
   * joins the product map (`lib/graph/origin.ts`). Null means the project has not said yet.
   */
  siteUrl: string | null;
  question: string;
  page: PageContext;
  conversationId?: string;
  /** Random id from the visitor's browser; the key of everything the agent remembers. */
  visitorId?: string;
  /** The project's own thresholds, from `project.settings`. */
  thresholds?: { docsThreshold?: number; interfaceThreshold?: number };
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
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
  required: ["answer", "steps"],
  additionalProperties: false,
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    exists: { type: "boolean" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["exists", "confidence", "reasoning"],
  additionalProperties: false,
};

const REQUEST_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    area: { type: "string" },
    quote: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["title", "description", "area", "quote", "rationale"],
  additionalProperties: false,
};

/** The remembered facts as a prompt block, empty when this is a first visit. */
function memoryBlock(memory: string[]): string {
  if (memory.length === 0) return "";
  return `\n\nWhat we know about this visitor:\n${memory.map((fact) => `- ${fact}`).join("\n")}`;
}

type BoundRoute = {
  steps: Step[];
  target: { route: string; key: string };
  destination: { route: string; title: string };
};

/**
 * A route the graph can walk from this page, bound to the live control it starts with. The
 * model's captions are used when they pass the same checks as any plan; otherwise the route keeps
 * the captions written from the controls themselves, which always pass.
 */
function routeFromHere(
  graph: StoredGraph,
  page: PageContext,
  target: { route: string; key: string },
  captions: string[] = [],
): BoundRoute | { failed: string } {
  const plan = planRoute(graph, currentPageOf(page), target, captions);
  if (!plan) return { failed: "the product map has no route from this page to the target" };
  if (plan.steps.length === 0) return { failed: "the target is already active on this page" };
  const bound = bindFirstStep(plan.steps, page);
  if (!bound) return { failed: `the first control of the route, "${plan.steps[0]?.control.name}", is not on the page as scanned` };
  let steps = validatePlan(bound, page.affordances, MAX_ROUTE_STEPS);
  if (!steps && captions.length > 0) {
    const plain = planRoute(graph, currentPageOf(page), target);
    const rebound = plain ? bindFirstStep(plain.steps, page) : null;
    steps = rebound ? validatePlan(rebound, page.affordances, MAX_ROUTE_STEPS) : null;
  }
  if (!steps) return { failed: "the route did not pass validation" };
  const destination = graph.pages.find((candidate) => candidate.route === plan.target.route);
  return {
    steps,
    target: plan.target,
    destination: { route: plan.target.route, title: destination?.title ?? plan.target.route },
  };
}

/**
 * Turns the question into something the developers can build. Drafting it is what makes the
 * report offer possible, so every dead end draws one: the user is never left with "I could not
 * find it" and no way to say that it should exist.
 */
async function draftRequest(input: {
  projectId: string;
  conversationId: string;
  question: string;
  memory: string[];
}): Promise<FeatureRequest> {
  const started = Date.now();
  const drafted = await chatJson<FeatureRequest>(
    MODELS.answer,
    [
      {
        role: "system",
        content:
          "Turn one support request into a feature request for the developers. The quote must be copied exactly from the user's message. Any notes about the visitor are context for the rationale, never part of the quote. JSON only.",
      },
      { role: "user", content: `${input.question}${memoryBlock(input.memory)}` },
    ],
    REQUEST_SCHEMA,
    { name: "feature_request", maxTokens: 4000, effort: EFFORT.answer },
  );
  void emitTrace({
    projectId: input.projectId,
    conversationId: input.conversationId,
    kind: "model",
    title: "Drafted the feature request",
    detail: {
      model: MODELS.answer,
      purpose: "turn the question into something the developers can build",
      output_summary: drafted.title,
      latencyMs: Date.now() - started,
    },
    source: "agent",
  });
  return {
    ...drafted,
    quote: input.question.includes(drafted.quote.trim()) ? drafted.quote.trim() : input.question,
  };
}

/** What the widget adds to a dead end, when there is a repository the report can reach. */
function reportOffer(outcome: Verdict["outcome"], repoFullName: string | null): string {
  if (!repoFullName) return "";
  return outcome === "absent"
    ? " I can report this to the developers so they can build it. Would you like me to?"
    : " I can report it to the developers so they can look. Would you like me to?";
}

type Persisted = { messageId: string };

async function persistAnswer(input: {
  conversationId: string;
  text: string;
  steps: Step[] | null;
  probes: ProbeResult[];
  /** Null for an answer that ran no checks: there was no judgement to make. */
  verdict: Verdict | null;
  request: FeatureRequest | null;
  grounding: unknown;
}): Promise<Persisted> {
  const { data } = await serviceClient()
    .from("message")
    .insert({
      conversation_id: input.conversationId,
      role: "assistant",
      content: input.text,
      steps: input.steps,
      probes: input.probes,
      verdict: input.verdict,
      feature_request: input.request,
      grounding: input.grounding,
    })
    .select("id")
    .single();
  return { messageId: (data?.id as string) ?? "" };
}

/**
 * Keeps whatever the visitor said about themselves, and never costs them their answer.
 *
 * This runs after the answer has been streamed, on every path, because small talk is exactly
 * where a person says who they are.
 */
async function rememberQuietly(input: {
  projectId: string;
  conversationId: string;
  visitorId: string | undefined;
  question: string;
  answer: string;
  known: string[];
}): Promise<void> {
  try {
    const learned = await rememberFromTurn(input);
    if (learned.length === 0) return;
    await emitTrace({
      projectId: input.projectId,
      conversationId: input.conversationId,
      kind: "model",
      title: "Remembered about this visitor",
      detail: {
        model: MODELS.understand,
        purpose: "keep durable facts about the visitor",
        output_summary: learned.join(" "),
        facts: learned,
      },
      source: "agent",
    });
  } catch {
    // Memory is a convenience. A failed extraction must never cost the user their answer.
  }
}

/**
 * The answer a known route gives, streamed whole. Returns false when the route cannot start from
 * the page the visitor is on, and then the turn carries on and works it out again.
 *
 * `announce` is true when nothing has emitted `understanding` yet, which is the case for an exact
 * intent-key hit: that one is served before the message is even read.
 */
async function* knownRouteTurn(input: {
  projectId: string;
  conversationId: string;
  messageId: string;
  page: PageContext;
  graph: StoredGraph;
  cached: KnownRoute;
  memory: string[];
  announce: boolean;
  turnStarted: number;
  /** `memory` when the route was remembered from a walk a person completed (`lib/routes`). */
  origin?: "known" | "memory";
}): AsyncGenerator<ChatEvent, boolean> {
  const { projectId, conversationId, page, graph, cached, turnStarted } = input;
  const route = routeFromHere(graph, page, cached.target);
  if ("failed" in route) return false;

  if (input.announce) {
    yield { type: "understanding", feature: cached.feature, intent: "product", memory: input.memory };
  }
  const remembered = input.origin === "memory";
  const plan: PlanSummary = { source: remembered ? "memory" : "cached", total: route.steps.length, destination: route.destination };
  const verdict: Verdict = {
    outcome: "answer",
    confidence: 0.9,
    reasoning: `A question with this intent resolved before to "${cached.target.key.split("|")[1] ?? ""}" on ${route.destination.title}.`,
    feature: cached.feature,
  };
  const persisted = await persistAnswer({
    conversationId,
    text: cached.answer,
    steps: route.steps,
    probes: [],
    verdict,
    request: null,
    grounding: null,
  });
  void emitTrace({
    projectId,
    conversationId,
    kind: "decision",
    title: remembered
      ? `Remembered route: ${route.steps.length} step${route.steps.length === 1 ? "" : "s"}, confirmed by ${cached.hitCount} walk${cached.hitCount === 1 ? "" : "s"}`
      : `Known route: ${route.steps.length} step${route.steps.length === 1 ? "" : "s"} from the product map`,
    detail: {
      source: plan.source,
      intent: cached.intent,
      feature: cached.feature,
      target: cached.target,
      destination: route.destination,
      steps: route.steps.map((step) => step.caption),
      modelCalls: input.announce ? 0 : 1,
      latencyMs: Date.now() - turnStarted,
    },
    source: "agent",
  });
  yield {
    type: "answer",
    text: cached.answer,
    steps: route.steps,
    escalation: { offered: false },
    noted: false,
    plan,
    sources: cached.sources,
  };
  yield { type: "conversation", conversationId, messageId: persisted.messageId || input.messageId };
  if (!remembered) void touchKnownRoute(cached.id, cached.hitCount).catch(() => undefined);
  // The console's outcome, without a model: the walk was shown, and that is the summary.
  await serviceClient()
    .from("conversation")
    .update({ outcome: "solved", summary: `Showed the way to ${cached.feature} from a known route.` })
    .eq("id", conversationId);
  return true;
}

export async function* runTurn(input: TurnInput): AsyncGenerator<ChatEvent> {
  const db = serviceClient();
  const { projectId, question, page } = input;

  // 1. Persist the conversation and the user's message.
  let conversationId = input.conversationId;
  if (!conversationId) {
    const { data } = await db
      .from("conversation")
      .insert({
        project_id: projectId,
        page_url: page.url,
        page_title: page.title,
        visitor_id: input.visitorId ?? null,
      })
      .select("id")
      .single();
    conversationId = (data?.id as string) ?? "";
  }
  const { data: userMessage } = await db
    .from("message")
    .insert({ conversation_id: conversationId, role: "user", content: question })
    .select("id")
    .single();
  const messageId = (userMessage?.id as string) ?? "";
  yield { type: "conversation", conversationId, messageId };

  // 2. The page joins the site graph, and everything the turn might need starts together.
  //
  // The scan is what makes the current page a node a route can start from, so it is written
  // before the graph is read. The visitor's facts and the exact-intent lookup need no model and
  // run beside it.
  const turnStarted = Date.now();
  const intent = intentKey(question);
  // Every product question needs this vector, and it is the longest cheap thing in the turn, so
  // it runs beside the reading. A message that turns out to be small talk never reads it.
  const questionEmbedding = embed([question]).then(([vector]) => {
    if (!vector) throw new Error("The embedding service returned nothing for the question");
    return vector;
  });
  // Claimed here so a failure surfaces at the probe that uses it, not as an unhandled rejection.
  questionEmbedding.catch(() => undefined);

  // Reading the message is the one thing every turn waits on, so it starts now, beside the
  // lookups and the graph. What it decides is which of them are read at all.
  const understandStarted = Date.now();
  const understandingPromise = understand(question, page);
  understandingPromise.catch(() => undefined);
  const graphPromise = loadGraph(projectId);
  graphPromise.catch(() => undefined);

  // Only the site the project names teaches the product map. A preview deployment of an unmerged
  // branch serves the same product on another origin, and one visit to it would otherwise put
  // controls the live site has not got in front of the next visitor (`lib/graph/origin.ts`).
  const ownSite = belongsToSite(input.siteUrl, page.url);
  if (!ownSite) {
    void emitTrace({
      projectId,
      conversationId,
      kind: "decision",
      title: "This page is not on the project's site, so nothing about it was recorded",
      detail: { pageUrl: page.url, siteUrl: input.siteUrl },
      source: "agent",
    });
  }

  const [, memory, known, recalled] = await Promise.all([
    ownSite ? recordScan(projectId, page, "widget").catch(() => undefined) : Promise.resolve(undefined),
    loadVisitorFacts(projectId, input.visitorId),
    findKnownRoute(projectId, intent).catch(() => null),
    recallRoute(projectId, question).catch(() => null),
  ]);

  // A route a person walked to the end outranks one that was only answered: it is served first.
  if (recalled) {
    const served = yield* knownRouteTurn({
      projectId,
      conversationId,
      messageId,
      page,
      graph: mapWithCurrentPage(await graphPromise, page),
      cached: rememberedAsKnown(recalled),
      memory,
      announce: true,
      turnStarted,
      origin: "memory",
    });
    if (served) return;
  }

  // 3. An exact intent-key hit is this question asked again: the same concepts, in a question
  // that already resolved to a control on this site. It is served from the product map before
  // the message is even read, which is what keeps a repeat under a second and free of a model.
  const graphForKnown = known ? mapWithCurrentPage(await graphPromise, page) : null;
  if (known && graphForKnown) {
    const served = yield* knownRouteTurn({
      projectId,
      conversationId,
      messageId,
      page,
      graph: graphForKnown,
      cached: known,
      memory,
      announce: true,
      turnStarted,
    });
    if (served) return;
  }

  // 4. Read the message: what kind it is, and what capability it names.
  const understanding = await understandingPromise;
  const understandMs = Date.now() - understandStarted;
  void emitTrace({
    projectId,
    conversationId,
    kind: "model",
    title: `Read the message: ${understanding.intent}`,
    detail: {
      model: MODELS.understand,
      purpose: "decide what kind of message this is and name the capability it is about",
      output_summary: understanding.feature || understanding.intent,
      intent: understanding.intent,
      latencyMs: understandMs,
    },
    source: "agent",
  });
  yield { type: "understanding", feature: understanding.feature, intent: understanding.intent, memory };

  // 5. A message that is not about what the product can do is answered here, and no check runs.
  if (understanding.intent === "chat" || understanding.intent === "page") {
    const chatting = understanding.intent === "chat";
    const direct = chatting
      ? await answerChat({ question, page, memory })
      : await answerFromPage({ question, page, memory });
    void emitTrace({
      projectId,
      conversationId,
      kind: "model",
      title: chatting ? "Answered without the checks" : "Answered from this page",
      detail: {
        model: MODELS.understand,
        purpose: understanding.intent,
        output_summary: direct.text,
        latencyMs: direct.latencyMs,
      },
      source: "agent",
    });
    const persisted = await persistAnswer({
      conversationId,
      text: direct.text,
      steps: null,
      probes: [],
      verdict: null,
      request: null,
      grounding: null,
    });
    yield { type: "answer", text: direct.text, steps: null, escalation: { offered: false }, noted: false };
    yield { type: "conversation", conversationId, messageId: persisted.messageId || messageId };
    // The console's outcome, without a model: nothing was checked, so there is nothing to judge.
    await db
      .from("conversation")
      .update({
        outcome: direct.answered ? "solved" : "unresolved",
        summary: chatting
          ? "Answered a message that was not about the product."
          : direct.answered
            ? "Answered from the page the visitor was on."
            : "The page the visitor was on did not show the answer.",
      })
      .eq("id", conversationId);
    await rememberQuietly({
      projectId,
      conversationId,
      visitorId: input.visitorId,
      question,
      answer: direct.text,
      known: memory,
    });
    return;
  }

  // 6. A wording of this question resolved before: the answer is the route, planned again from
  // this page. A nearer wording only counts once the message is known to be about the product.
  const graph = await graphPromise;
  // The page the visitor is standing on is part of the map for the length of this turn, whether
  // or not it was ever written down (`lib/graph/live.ts`). The capabilities check keeps the
  // stored map: what it searched is a claim about the product, not about this page.
  const siteMap = mapWithCurrentPage(graph, page);
  const nearest = await questionEmbedding.then((vector) => nearestKnownRoute(projectId, vector)).catch(() => null);
  if (nearest) {
    const served = yield* knownRouteTurn({
      projectId,
      conversationId,
      messageId,
      page,
      graph: siteMap,
      cached: nearest,
      memory,
      announce: false,
      turnStarted,
    });
    if (served) return;
  }

  // 7. Three independent checks, run together so the slowest bounds the turn.
  for (const probe of ["docs", "interface", "repository"] as const) {
    yield { type: "probe", probe, status: "running" };
  }
  // What this project files against, read from the project row beside the checks. Both the
  // capabilities check and the offer at the end speak about the customer's repository, so neither
  // is decided by a value this turn happened to be started without.
  const repository = boundRepository(projectId, input.repoFullName);
  const [repoFullName, docs, ui, capabilities] = await Promise.all([
    repository,
    probeDocs(`${question} ${understanding.feature}`, projectId, questionEmbedding, input.thresholds?.docsThreshold),
    Promise.resolve(probeInterface(question, page, understanding.feature)),
    repository.then((bound) =>
      probeCapabilities(
        projectId,
        understanding.feature,
        graph,
        bound,
        input.defaultBranch,
        input.thresholds?.interfaceThreshold,
      ),
    ),
  ]);
  const probes: ProbeResult[] = [docs, ui, capabilities];
  for (const result of probes) {
    yield { type: "probe", probe: result.probe, status: "done", result };
    void emitTrace({
      projectId,
      conversationId,
      kind: "probe",
      title: `Checked ${result.probe}`,
      status: result.hit ? "ok" : "failed",
      detail: result,
      source: "agent",
    });
  }

  // 8. Route on the evidence. Absence is confirmed by a reasoning model.
  let outcome = routeProbes(probes, input.thresholds);
  let verdict: Verdict = {
    outcome,
    confidence: 0.8,
    reasoning: probes.map((p) => p.summary).join(" "),
    feature: understanding.feature,
  };
  let verdictMs: number | null = null;
  if (outcome === "absent") {
    const verdictStarted = Date.now();
    const confirmed = await chatJson<{ exists: boolean; confidence: number; reasoning: string }>(
      MODELS.verdict,
      [
        {
          role: "system",
          content:
            "Three independent checks looked for a product capability and found nothing. Decide whether the capability exists. Be conservative: say it does not exist only when the evidence supports it. JSON only.",
        },
        {
          role: "user",
          content: `Capability: ${understanding.feature}\nQuestion: ${question}\n\n${probes
            .map((p) => `${p.probe}: ${p.summary}`)
            .join("\n")}`,
        },
      ],
      VERDICT_SCHEMA,
      { name: "verdict", maxTokens: 4000, effort: EFFORT.verdict },
    );
    verdictMs = Date.now() - verdictStarted;
    outcome = confirmed.exists ? "hedge" : "absent";
    verdict = {
      outcome,
      confidence: confirmed.confidence,
      reasoning: confirmed.reasoning,
      feature: understanding.feature,
    };
  }
  yield { type: "verdict", verdict };
  void emitTrace({
    projectId,
    conversationId,
    kind: "verdict",
    title: `Verdict: ${outcome}`,
    detail: verdictMs === null ? verdict : { ...verdict, model: MODELS.verdict, latencyMs: verdictMs },
    source: "agent",
  });

  // 9. Answer.
  let text = "";
  let steps: Step[] | null = null;
  let request: FeatureRequest | null = null;
  let plan: PlanSummary | undefined;
  let sources: AnswerSource[] = [];

  // The docs passages behind this answer, kept on the message so continuing the
  // guidance later does not have to search for them again.
  let grounding: unknown = null;

  if (outcome === "answer") {
    grounding = docs.evidence;
    const docsEvidence = (Array.isArray(docs.evidence) ? docs.evidence : []) as DocsEvidence[];
    const candidates =
      siteMap.controls.length > 0 ? candidatesFor(siteMap, understanding.feature, page, docsEvidence, docs.hit) : [];
    // The controls the visitor can press right now that do what was asked. One of them is the
    // answer, so the page planner is never reached while there is one.
    const here = controlsOnThisPage(candidates, page, understanding.feature);

    let answered = false;
    let resolved = "";
    if (candidates.length > 0) {
      // The graph knows controls for this. The model picks one and writes the words; the route
      // is already computed for every candidate, so the count is fixed before the model speaks.
      const resolution = await resolveTarget({
        question,
        feature: understanding.feature,
        candidates,
        docs: docsEvidence,
        docsHit: docs.hit,
        memory,
      });
      void emitTrace({
        projectId,
        conversationId,
        kind: "model",
        title: resolution.target ? `Resolved the target: "${resolution.target.control.name}"` : "No control does exactly this",
        detail: {
          model: MODELS.plan,
          purpose: "choose the control that does what was asked and write the answer",
          output_summary: resolution.answer,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.control.name,
            route: candidate.control.route,
            score: Number(candidate.score.toFixed(2)),
            steps: candidate.route?.steps.length ?? null,
          })),
          chosen: resolution.target?.id ?? null,
          latencyMs: resolution.latencyMs,
        },
        source: "agent",
      });
      sources = resolution.sources;
      // A control the visitor is looking at that does what was asked is the answer, whatever the
      // model decided: it is on the screen and pressing it is the whole route. Without this the
      // turn fell through to the page planner, which had a seat map to choose from.
      const chosen = resolution.target ?? here[0] ?? null;
      if (chosen && !resolution.target) {
        void emitTrace({
          projectId,
          conversationId,
          kind: "decision",
          title: `The page has the control for this: "${chosen.control.name}"`,
          detail: {
            reason: "the model chose none, and this control on this page covers the capability",
            feature: understanding.feature,
            control: { name: chosen.control.name, role: chosen.control.role, route: chosen.control.route },
          },
          source: "agent",
        });
      }
      if (chosen) {
        const target = { route: chosen.control.route, key: chosen.control.key };
        const route = routeFromHere(siteMap, page, target, resolution.target ? resolution.captions : []);
        if ("failed" in route) {
          void emitTrace({
            projectId,
            conversationId,
            kind: "decision",
            status: "failed",
            title: "The route could not start from this page",
            detail: {
              target,
              reason: route.failed,
              from: currentPageOf(page).route,
              // What the widget saw, so a binding that failed can be explained from the trace.
              scanned: page.affordances.map((a) => `${a.id} ${a.role} "${a.name}"${a.landmark ? ` in ${a.landmark}` : ""}${a.href ? ` -> ${a.href}` : ""}${a.visible ? "" : " (hidden)"}`),
            },
            source: "agent",
          });
        } else {
          // The words the model wrote, unless it wrote none or it is not the one that chose: a
          // sentence from the control itself is always true, and a control on this page is on
          // this page, not on a page title with the site's name after it.
          const where =
            chosen.control.route === currentPageOf(page).route
              ? "on this page"
              : `on ${route.destination.title}`;
          text =
            (resolution.target ? resolution.answer : "") ||
            `You can do this with "${chosen.control.name}" ${where}. I will show you.`;
          steps = route.steps;
          plan = { source: "graph", total: route.steps.length, destination: route.destination };
          answered = true;
          void emitTrace({
            projectId,
            conversationId,
            kind: "decision",
            title: `Planned the route: ${route.steps.length} step${route.steps.length === 1 ? "" : "s"} over the product map`,
            detail: {
              source: "graph",
              from: currentPageOf(page).route,
              target,
              destination: route.destination,
              steps: route.steps.map((step) => step.caption),
              latencyMs: Date.now() - turnStarted,
            },
            source: "agent",
          });
          // Remembered only when the page it was answered from is the project's own site: a route
          // learned on a preview deployment would pin this question to a control the live site has
          // not got.
          if (ownSite) {
            void saveKnownRoute(projectId, {
              intent,
              feature: understanding.feature,
              question,
              target,
              answer: text,
              sources,
              embedding: await questionEmbedding.catch(() => null),
            }).catch((error: unknown) => console.warn("known route not saved:", (error as Error).message));
          }
        }
      }
      resolved = resolution.answer;
      if (!answered && !resolution.target && resolution.answer && docs.hit) {
        // The documentation answers it and no control is the answer: a policy, a fee, a rule.
        text = resolution.answer;
        answered = true;
      }
    }

    // No control anywhere does this, so plan over the page in front of the user, as far as it
    // goes. Only the documentation or a control on this page may put the turn here, and never
    // while a control the visitor can see does what was asked: that one is the answer, and a
    // model handed the 169 controls of a seat map instead will plan a seat-by-seat click-through
    // of a capability the product has not got.
    if (!answered && (docs.hit || ui.hit) && here.length === 0) {
      const planStarted = Date.now();
      const pagePlan = await chatJson<{ answer: string; steps: Step[] }>(
        MODELS.plan,
        [
          {
            role: "system",
            content:
              "You are a support agent embedded in a web page. Answer ONLY from the documentation passages and the listed page elements. If they do not describe how to do exactly what was asked, say plainly that you could not find it and return no steps; never invent a button, page, or setting. Otherwise answer in one or two short sentences, then give the steps the user takes on the page in front of them. Every step target MUST be one of the listed element ids, exactly as written. Order the steps so the first one is a control that is on the page right now: if the flow continues inside a menu or dialog that is not open yet, make the first step the control that opens it and stop there. Never invent an id. Use at most 5 steps. Each caption is at most 12 words and starts with a verb. JSON only.",
          },
          {
            role: "user",
            content: `Question: ${question}${memoryBlock(memory)}\n\nDocumentation:\n${JSON.stringify(docs.evidence)}\n\nElements on this page:\n${affordanceList(page.affordances)}`,
          },
        ],
        PLAN_SCHEMA,
        { name: "plan", maxTokens: 4000, effort: EFFORT.plan },
      );
      void emitTrace({
        projectId,
        conversationId,
        kind: "model",
        title: "Planned the answer and the steps from this page",
        detail: {
          model: MODELS.plan,
          purpose: "answer from the documentation and name the controls on this page to point at",
          output_summary: pagePlan.answer,
          latencyMs: Date.now() - planStarted,
        },
        source: "agent",
      });
      text = pagePlan.answer;
      const known = new Set(page.affordances.map((a) => a.id));
      const reachable: Step[] = [];
      for (const step of dropRepeats(pagePlan.steps ?? [])) {
        if (typeof step.target !== "string" || !known.has(step.target)) break;
        reachable.push(step);
      }
      const validated = validatePlan(reachable, page.affordances);
      // A walk is only guidance when it ends on the control that does the thing. The steps before
      // it open a tab or a dialog; the last one is the answer, and on a page where every control
      // shares a word with the question, a walk that ends anywhere else is not one.
      steps =
        validated && planEndsOnCapability(validated, page, understanding.feature, docsEvidence)
          ? validated
          : null;
      if (steps) plan = { source: "page", total: steps.length };
      if (validated && !steps) {
        void emitTrace({
          projectId,
          conversationId,
          kind: "decision",
          status: "failed",
          title: "The steps from this page did not end on a control that does this",
          detail: {
            feature: understanding.feature,
            reason: "the last step is not the control the question asked for, so the answer is words alone",
            steps: validated.map((step) => step.caption),
          },
          source: "agent",
        });
      }
      if (docs.hit) sources = sourcesFrom(docsEvidence);
      answered = true;
    }

    if (!answered) {
      // Nothing to route to and nothing to plan. Say what is true and draft the request, so the
      // user gets the offer rather than a dead end.
      text = resolved || `I could not find a way of ${understanding.feature} here.`;
      request = await draftRequest({ projectId, conversationId, question, memory });
      text = `${text}${reportOffer("hedge", repoFullName)}`;
      void emitTrace({
        projectId,
        conversationId,
        kind: "decision",
        status: "failed",
        title: "No control on the site does this, so nothing was planned",
        detail: {
          feature: understanding.feature,
          reason: "the documentation and this page both missed, and no candidate control covers the capability",
          candidates: candidates.map((candidate) => candidate.control.name),
        },
        source: "agent",
      });
    }
  } else {
    request = await draftRequest({ projectId, conversationId, question, memory });
    // Only offer what can actually happen: without a repository there is nothing to file against.
    const offer = reportOffer(outcome, repoFullName);
    const searched = (capabilities.evidence as { graph?: { pages: number; controls: number } } | null)?.graph;
    const where = searched && searched.controls > 0
      ? `I checked the documentation, this page, and ${searched.pages} ${searched.pages === 1 ? "page" : "pages"} with ${searched.controls} controls of this product, and found nothing.`
      : "I checked the documentation, this page, and what this product is known to do, and found nothing.";

    // A mixed message asked something general and something about the product in one breath. The
    // documentation often answers the general half even when the product half is missing, and
    // reading that out first is more use to the visitor than an apology on its own.
    const passages = (Array.isArray(docs.evidence) ? docs.evidence : []) as DocsEvidence[];
    const relevant = passages.length > 0 && (docs.score ?? 0) >= DOCS_SURE_MISS;
    const fromDocs =
      understanding.intent === "mixed" && outcome === "absent" && relevant
        ? await answerFromPassage({ question, docs: passages })
        : null;
    if (fromDocs?.answered) {
      void emitTrace({
        projectId,
        conversationId,
        kind: "model",
        title: "Answered the part the documentation covers",
        detail: {
          model: MODELS.understand,
          purpose: "answer a mixed question from the documentation before stating the absence",
          output_summary: fromDocs.text,
          latencyMs: fromDocs.latencyMs,
        },
        source: "agent",
      });
      sources = sourcesFrom(passages);
    }

    text =
      outcome === "absent"
        ? fromDocs?.answered
          ? `${fromDocs.text} There is still no way of ${understanding.feature} here today. ${where}${offer}`
          : `I am sorry, there is no way of ${understanding.feature} here today. ${where}${offer}`
        : `I could not confirm that ${understanding.feature} is possible here. I did not find it in the documentation or on this page.${offer}`;
  }

  const persisted = await persistAnswer({ conversationId, text, steps, probes, verdict, request, grounding });

  // A gap the agent found joins the other reports of the same gap and rises with them, so the
  // console can see how often it comes back. Nothing is filed by it: opening an issue in the
  // customer's repository is what "Report to developers" is for.
  const note = request ? await noteRequest({ projectId, request }) : { noted: false, groupId: null };

  // A confirmed absence asks the second question: is this one person, or a pattern? The answer
  // comes from PostHog through the opportunity pipeline, enqueued here and run off this turn.
  if (outcome === "absent" && note.groupId) {
    void triggerDiscovery({ projectId, groupId: note.groupId, conversationId, trigger: "auto" });
  }

  yield {
    type: "answer",
    text,
    steps,
    escalation: escalationOffer(request, repoFullName),
    noted: note.noted,
    ...(plan ? { plan } : {}),
    ...(sources.length ? { sources } : {}),
  };

  // The widget escalates against the assistant message, so hand its id back.
  yield { type: "conversation", conversationId, messageId: persisted.messageId || messageId };

  // 10. Remember anything durable the visitor said about themselves, for their next visit.
  await rememberQuietly({
    projectId,
    conversationId,
    visitorId: input.visitorId,
    question,
    answer: text,
    known: memory,
  });

  // 11. Record how this ended. The user already has the answer; this is only for the console.
  try {
    await closeConversation({ conversationId, question, answer: text, steps, verdict });
  } catch {
    // A missing outcome shows as "in progress" in the console and is not worth failing a turn.
  }
}

/** The articles behind a documentation-grounded answer, at most two, in the order they matched. */
function sourcesFrom(docs: DocsEvidence[]): AnswerSource[] {
  const seen = new Set<string>();
  const sources: AnswerSource[] = [];
  for (const entry of docs) {
    const title = entry.documentTitle.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    sources.push({ title, url: entry.url });
  }
  return sources.slice(0, 2);
}
