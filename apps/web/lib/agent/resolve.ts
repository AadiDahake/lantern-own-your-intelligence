/**
 * Resolving a question to one control on the site.
 *
 * A candidate is a control that does what was asked, and there are two ways to be one: the
 * control's own accessible name accounts for the capability, or a documentation passage that
 * covers the question names it. The route to each candidate is computed here, deterministically,
 * and shown to the model. The model chooses the target and writes the answer and the captions.
 * It never counts steps, and it is never given a control to choose that does something else.
 */
import {
  EFFORT,
  MODELS,
  controlRefOf,
  coverageNeeded,
  coversCapability,
  planRoute,
  sameControl,
  searchControls,
} from "@lantern/shared";
import type { AnswerSource, PageContext, PlannedRoute, SiteControl, SiteGraph, Step } from "@lantern/shared";
import { chatJson } from "../openai";
import type { DocsEvidence } from "./probes";
import { currentPageOf } from "./bind";

export type Candidate = {
  id: string;
  control: SiteControl;
  pageTitle: string;
  score: number;
  route: PlannedRoute | null;
  /** Where pressing the control leads, when the graph has seen it navigate. */
  destination: { route: string; title: string } | null;
};

/** A link whose target is documentation rather than product. */
const DOCUMENTATION_ROUTE = /^(https?:\/\/[^/]+)?\/(help|support|faq|docs|documentation|knowledge|kb|guides?)(\/|$)/i;

function destinationOf(graph: SiteGraph, control: SiteControl): { route: string; title: string } | null {
  const transition = graph.transitions.find(
    (candidate) => candidate.kind === "navigation" && candidate.from === control.route && candidate.key === control.key,
  );
  if (!transition) return null;
  return { route: transition.to, title: titleOf(graph, transition.to) };
}

/** Enough to hold the right control and its rivals; more only makes the model slower. */
const MAX_CANDIDATES = 8;

function titleOf(graph: SiteGraph, route: string): string {
  return graph.pages.find((page) => page.route === route)?.title ?? route;
}

/** The words of the matched passages, once, for "does an article name this control". */
function documentationText(docs: DocsEvidence[]): string {
  return docs.map((entry) => `${entry.heading ?? ""} ${entry.snippet}`).join("\n").toLowerCase().trim();
}

/** Whether those words name this control. A very short label matches too much to count. */
function namedIn(text: string, name: string): boolean {
  const label = name.trim().toLowerCase();
  return text !== "" && label.length >= 4 && text.includes(label);
}

/**
 * Controls named in the documentation passages. A help article that says "select Change seats"
 * is strong evidence that the control called "Change seats" is the one, even when its name does
 * not repeat the words of the question: this is the documented purpose of the control, and it is
 * the only door into the candidates that the control's own name does not have to open.
 */
function namedInDocs(graph: SiteGraph, docs: DocsEvidence[]): SiteControl[] {
  const text = documentationText(docs);
  if (text === "") return [];
  return graph.controls.filter((control) => namedIn(text, control.name));
}

/**
 * The candidates, each with its route from the current page, best first.
 *
 * A candidate is a control the user could be routed to, so it has to be a control that does what
 * was asked: its own accessible name accounts for the capability, or a documentation passage that
 * covers the question names it. A seat button is not a way of finding seats together, and neither
 * is any other control that happens to share one word with the question; without this rule the
 * model was handed a page of them and asked to choose.
 */
export function candidatesFor(
  graph: SiteGraph,
  feature: string,
  page: PageContext,
  docs: DocsEvidence[],
  docsHit = false,
): Candidate[] {
  const current = currentPageOf(page);
  const scored = new Map<string, { control: SiteControl; score: number }>();
  const keyOf = (control: SiteControl) => `${control.route}\n${control.key}`;
  const needed = coverageNeeded(feature);

  for (const match of searchControls(graph, feature, MAX_CANDIDATES)) {
    if (match.coverage < needed) continue;
    scored.set(keyOf(match.control), { control: match.control, score: match.score });
  }
  if (docsHit) {
    for (const control of namedInDocs(graph, docs)) {
      const existing = scored.get(keyOf(control));
      scored.set(keyOf(control), { control, score: Math.max(existing?.score ?? 0, 0.5) + 0.3 });
    }
  }

  // The same control sits on many pages: a help link in the footer of every article is one
  // candidate, not eight. One entry per identity, and the copy kept is the one the user can
  // actually be walked to, or the model is handed a list with no reachable target in it.
  const nearest = new Map<string, { control: SiteControl; score: number; route: PlannedRoute | null }>();
  for (const entry of scored.values()) {
    const route = planRoute(graph, current, { route: entry.control.route, key: entry.control.key });
    const held = nearest.get(entry.control.key);
    if (!held || nearer({ ...entry, route }, held)) nearest.set(entry.control.key, { ...entry, route });
  }

  return [...nearest.values()]
    .sort((a, b) => stepsOf(a.route) - stepsOf(b.route) || b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((entry, index) => ({
      id: `c${index + 1}`,
      control: entry.control,
      pageTitle: titleOf(graph, entry.control.route),
      score: entry.score,
      route: entry.route,
      destination: destinationOf(graph, entry.control),
    }));
}

/**
 * The candidates the visitor can see and press right now, and whose own name does what was asked.
 *
 * One of these is always the answer: it is on the screen, it does the thing, and the route to it
 * is the one step of pressing it. It is also what says the page planner is not needed, because
 * that planner exists for the case where nothing on the page does what was asked.
 */
export function controlsOnThisPage(candidates: Candidate[], page: PageContext, feature: string): Candidate[] {
  const current = currentPageOf(page);
  return candidates.filter(
    (candidate) =>
      candidate.control.route === current.route &&
      current.visibleKeys?.has(candidate.control.key) === true &&
      coversCapability(feature, candidate.control.name),
  );
}

/**
 * Whether a plan over the page in front of the visitor ends on a control that does what was
 * asked: its own name accounts for the capability, or a documentation passage names it.
 *
 * The steps before the last one are how a flow is opened - a tab, a menu, a dialog - and they are
 * free. The last one is the answer, and on a seat map every control shares a word with the
 * question: without this, "find us three seats together" came back as three clicks on three
 * seats, which is the thing the visitor was already doing by hand.
 */
export function planEndsOnCapability(
  steps: readonly Step[],
  page: PageContext,
  feature: string,
  docs: DocsEvidence[],
): boolean {
  const last = steps[steps.length - 1];
  if (!last) return false;
  const affordance = page.affordances.find((candidate) => candidate.id === last.target);
  if (!affordance) return false;
  if (coversCapability(feature, affordance.name)) return true;
  return namedIn(documentationText(docs), affordance.name);
}

/** How far a candidate is, with an unreachable one last. */
function stepsOf(route: PlannedRoute | null): number {
  return route ? route.steps.length : Number.MAX_SAFE_INTEGER;
}

/** Whether one copy of a control is the better one to offer: nearer first, then better matched. */
function nearer(
  candidate: { score: number; route: PlannedRoute | null },
  held: { score: number; route: PlannedRoute | null },
): boolean {
  const distance = stepsOf(candidate.route) - stepsOf(held.route);
  return distance === 0 ? candidate.score > held.score : distance < 0;
}

function describeCandidate(candidate: Candidate): string {
  const documentation = DOCUMENTATION_ROUTE.test(candidate.control.href ?? "");
  const leads = candidate.destination
    ? `, leads to ${documentation ? "the help article " : ""}"${candidate.destination.title}" (${candidate.destination.route})`
    : documentation
      ? ", leads to a help article"
      : "";
  const where = `${candidate.control.role} "${candidate.control.name}" on ${candidate.pageTitle} (${candidate.control.route})${leads}`;
  if (!candidate.route) return `${candidate.id}: ${where}. No known route from this page.`;
  const steps = candidate.route.steps;
  if (steps.length === 0) return `${candidate.id}: ${where}. Already active on this page.`;
  return `${candidate.id}: ${where}. ${steps.length} step${steps.length === 1 ? "" : "s"} from here: ${steps
    .map((step) => `${step.control.role} "${step.control.name}"`)
    .join(" > ")}`;
}

const RESOLVE_SCHEMA = {
  type: "object",
  properties: {
    target: { type: "string" },
    answer: { type: "string" },
    captions: { type: "array", items: { type: "string" } },
  },
  required: ["target", "answer", "captions"],
  additionalProperties: false,
};

const SYSTEM = [
  "You are a support agent embedded in a web product. A user asked how to do something.",
  "You are given the documentation passages that matched and a list of candidate controls on the site, each with the route to reach it from the page the user is on.",
  "Choose the one control that does exactly what the user asked, judged by the documentation, the control names and where each control leads. A link to a help article only describes the thing; prefer the control that does it. Answer with its id, or \"none\" if no candidate does exactly that; never guess.",
  "Write the answer in one or two short sentences that stay true from any page of the site: say where the capability lives and that you will show the way. When a documentation passage grounded the choice, name the article it came from.",
  "Write one caption per step of the chosen candidate's route, in order: imperative, at most 12 words, naming the control as it is written. For a form step, say what to enter. Give an empty list when the target is \"none\".",
  "Never mention candidate ids in the answer. JSON only.",
].join(" ");

export type Resolution = {
  target: Candidate | null;
  answer: string;
  captions: string[];
  sources: AnswerSource[];
  latencyMs: number;
};

function sourcesOf(docs: DocsEvidence[], used: boolean): AnswerSource[] {
  if (!used) return [];
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

/** Asks the model to pick the target and write the words. The candidates and their routes are fixed. */
export async function resolveTarget(input: {
  question: string;
  feature: string;
  candidates: Candidate[];
  docs: DocsEvidence[];
  docsHit: boolean;
  memory: string[];
}): Promise<Resolution> {
  const started = Date.now();
  const memory = input.memory.length ? `\n\nWhat we know about this visitor:\n${input.memory.map((fact) => `- ${fact}`).join("\n")}` : "";
  // A passage the documentation check rejected grounds nothing. Showing it anyway had the model
  // citing the article the check had just read and turned down.
  const passages = input.docsHit
    ? input.docs.slice(0, 2).map((entry) => ({
        article: entry.documentTitle,
        heading: entry.heading,
        passage: entry.snippet.slice(0, 200),
      }))
    : [];
  const result = await chatJson<{ target: string; answer: string; captions: string[] }>(
    MODELS.plan,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Question: ${input.question}`,
          `Capability: ${input.feature}${memory}`,
          `Documentation:\n${passages.length ? JSON.stringify(passages) : "none"}`,
          `Candidates:\n${input.candidates.map(describeCandidate).join("\n") || "none"}`,
        ].join("\n\n"),
      },
    ],
    RESOLVE_SCHEMA,
    // A choice from a short list and three short sentences: the smallest effort the model offers
    // is enough, and the user is watching the status line while it runs.
    { name: "resolve_target", maxTokens: 2000, effort: EFFORT.resolve },
  );
  const target = input.candidates.find((candidate) => candidate.id === result.target.trim()) ?? null;
  const captions = Array.isArray(result.captions)
    ? result.captions.filter((caption): caption is string => typeof caption === "string").map((caption) => caption.trim())
    : [];
  return {
    target,
    answer: typeof result.answer === "string" ? result.answer.trim() : "",
    captions,
    sources: sourcesOf(input.docs, input.docsHit),
    latencyMs: Date.now() - started,
  };
}

/** The same control regardless of where on the page it sits: a nav link and a hero link to one place. */
function sameControlAnywhere(a: { role: string; name: string; href?: string }, b: { role: string; name: string; href?: string }): boolean {
  return sameControl({ role: a.role, name: a.name, href: a.href }, { role: b.role, name: b.name, href: b.href });
}

/**
 * Binds the first step of a route to the live page: the affordance id the widget can spotlight
 * right now. The control the planner named is preferred; a visible twin of it elsewhere on the
 * page (the same link in the hero rather than in the navigation) is taken over a copy the widget
 * could not see, and the step then names the twin so the widget binds the same element. Null
 * when no copy of the control is on the page as scanned.
 */
export function bindFirstStep(steps: Step[], page: PageContext): Step[] | null {
  const first = steps[0];
  if (!first?.control) return null;
  const wanted = first.control;
  const refs = page.affordances.map((affordance) => ({ affordance, ref: controlRefOf(affordance, page.url) }));
  const live =
    refs.find(({ affordance, ref }) => affordance.visible && sameControl(ref, wanted)) ??
    refs.find(({ affordance, ref }) => affordance.visible && sameControlAnywhere(ref, wanted)) ??
    refs.find(({ ref }) => sameControlAnywhere(ref, wanted));
  if (!live) return null;
  const control = { ...wanted, ...live.ref, route: wanted.route };
  return steps.map((step, index) =>
    index === 0 ? { ...step, target: live.affordance.id, control } : { ...step, target: null },
  );
}
