/**
 * Deterministic route planning over the site graph.
 *
 * A question resolves to one target control. The plan is then the shortest path from the page the
 * user is on to that control, read off the graph: no model counts steps, so the number the widget
 * announces is the number of steps the walk takes.
 */
import { keywordScore, concepts } from "./text";
import { advanceOnFor, captionFor, controlKey, sameControl } from "./site";
import type { ControlRef, SiteControl, SiteGraph, SiteTransition } from "./site";
import type { Step } from "./types";

/** Beyond this a route is a tour, not guidance. */
export const MAX_ROUTE_STEPS = 8;

export type RouteTarget = { route: string; key: string };

/** What the planner knows about the page the user is on right now. */
export type CurrentPage = {
  route: string;
  /** Keys of the controls the widget can see and reach on the page as it is now. */
  visibleKeys?: ReadonlySet<string>;
  /** Keys of the controls already active (a selected tab, an open menu). Never a step. */
  activeKeys?: ReadonlySet<string>;
};

export type RouteStep = Step & { control: ControlRef & { route: string } };

function byKey(graph: SiteGraph): Map<string, SiteControl> {
  const map = new Map<string, SiteControl>();
  for (const control of graph.controls) map.set(`${control.route}\n${control.key}`, control);
  return map;
}

function controlAt(index: Map<string, SiteControl>, route: string, key: string): SiteControl | null {
  return index.get(`${route}\n${key}`) ?? null;
}

function stepFor(control: SiteControl, navigates: boolean, caption?: string): RouteStep {
  const ref: ControlRef & { route: string } = { role: control.role, name: control.name, route: control.route };
  if (control.landmark) ref.landmark = control.landmark;
  if (control.href) ref.href = control.href;
  return {
    target: null,
    caption: caption ?? captionFor(control),
    advanceOn: advanceOnFor(control, navigates),
    control: ref,
  };
}

/**
 * The control that has to be pressed first so `control` appears, when the page as it is now does
 * not show it. Only one level: a reveal behind a reveal is rare and a guess would not help.
 */
function revealFor(
  graph: SiteGraph,
  index: Map<string, SiteControl>,
  control: SiteControl,
  current: CurrentPage | null,
): SiteControl | null {
  const onCurrentPage = current !== null && current.route === control.route;
  const visible = onCurrentPage
    ? current.visibleKeys
      ? current.visibleKeys.has(control.key)
      : control.visible
    : control.visible;
  if (visible) return null;
  const reveal = graph.transitions.find(
    (transition) =>
      transition.kind === "reveal" && transition.from === control.route && transition.reveals === control.key,
  );
  if (!reveal) return null;
  const opener = controlAt(index, reveal.from, reveal.key);
  if (!opener) return null;
  if (onCurrentPage && current.activeKeys?.has(opener.key)) return null;
  if (onCurrentPage && current.visibleKeys && !current.visibleKeys.has(opener.key)) return null;
  return opener;
}

/** Breadth-first over navigation transitions. Returns the transitions taken, or null. */
function shortestPath(graph: SiteGraph, from: string, to: string): SiteTransition[] | null {
  if (from === to) return [];
  const previous = new Map<string, SiteTransition>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const route = queue.shift() as string;
    for (const transition of graph.transitions) {
      if (transition.kind !== "navigation" || transition.from !== route || transition.to === route) continue;
      if (seen.has(transition.to)) continue;
      seen.add(transition.to);
      previous.set(transition.to, transition);
      if (transition.to === to) {
        const path: SiteTransition[] = [];
        let cursor = to;
        while (cursor !== from) {
          const step = previous.get(cursor) as SiteTransition;
          path.unshift(step);
          cursor = step.from;
        }
        return path;
      }
      queue.push(transition.to);
    }
  }
  return null;
}

export type PlannedRoute = {
  steps: RouteStep[];
  target: SiteControl;
};

/**
 * The steps from the current page to the target control, or null when the graph does not connect
 * them. The last step is the target itself unless the target is already active on the current
 * page, in which case there is nothing to do and the plan is empty.
 */
export function planRoute(
  graph: SiteGraph,
  current: CurrentPage,
  target: RouteTarget,
  captions: readonly string[] = [],
): PlannedRoute | null {
  const index = byKey(graph);
  const destination = controlAt(index, target.route, target.key);
  if (!destination) return null;
  const path = shortestPath(graph, current.route, target.route);
  if (path === null) return null;

  const steps: RouteStep[] = [];
  for (const transition of path) {
    const control = controlAt(index, transition.from, transition.key);
    if (!control) return null;
    const opener = revealFor(graph, index, control, steps.length === 0 ? current : null);
    if (opener) steps.push(stepFor(opener, false));
    steps.push(stepFor(control, true));
  }

  if (current.route === target.route && current.activeKeys?.has(destination.key)) {
    return { steps, target: destination };
  }
  const opener = revealFor(graph, index, destination, path.length === 0 ? current : null);
  if (opener) steps.push(stepFor(opener, false));
  const navigates = graph.transitions.some(
    (transition) =>
      transition.kind === "navigation" && transition.from === destination.route && transition.key === destination.key,
  );
  steps.push(stepFor(destination, navigates));

  if (steps.length > MAX_ROUTE_STEPS) return null;
  if (captions.length === steps.length) {
    for (let index = 0; index < steps.length; index += 1) {
      const caption = captions[index]?.trim();
      if (caption) (steps[index] as RouteStep).caption = caption;
    }
  }
  return { steps, target: destination };
}

export type ControlMatch = {
  control: SiteControl;
  page: { route: string; title: string };
  /** Ranking score: the name, with the page title able to lift it above a namesake elsewhere. */
  score: number;
  /**
   * How much of the capability the control's own accessible name accounts for, 0 to 1. This is
   * what decides whether the control is the thing asked for; the page title never counts towards
   * it, or a nav link on an article about seats would be a way of choosing one.
   */
  coverage: number;
};

/** Words that name a control without saying what it does. */
const GENERIC = new Set(["home", "skip", "main", "content", "menu", "close", "open", "back"]);

/** A link into the documentation is about the capability; it is not the capability. */
const DOCUMENTATION_ROUTE = /^(https?:\/\/[^/]+)?\/(help|support|faq|docs|documentation|knowledge|kb|guides?)(\/|$)/i;

function documentationLink(control: SiteControl): boolean {
  return control.role === "link" && typeof control.href === "string" && DOCUMENTATION_ROUTE.test(control.href);
}

/**
 * The controls anywhere on the site whose name says what the question asks for, best first.
 *
 * Two numbers come back for each: `coverage`, how much of the capability the control's own name
 * accounts for, and `score`, the rank. The page title only ever moves the rank, so "Seats" on the
 * Manage Trip page outranks "Seats" in a footer, while "Find a flight" on an article titled "How
 * do I change my seat?" is still a link to the flight search and covers nothing.
 */
export function searchControls(graph: SiteGraph, feature: string, limit = 12, minScore = 0): ControlMatch[] {
  const wanted = concepts(feature);
  if (wanted.size === 0) return [];
  const titles = new Map(graph.pages.map((page) => [page.route, page.title]));
  const matches: ControlMatch[] = [];
  for (const control of graph.controls) {
    const name = control.name.trim();
    if (!name || GENERIC.has(name.toLowerCase())) continue;
    // The control's own name has to carry at least one concept, and it alone decides coverage.
    const own = keywordScore(feature, name);
    if (own <= 0) continue;
    const withPage = keywordScore(feature, `${name} ${titles.get(control.route) ?? ""}`);
    let score = Math.max(own, withPage * 0.8);
    // A link into the documentation is about the capability; it is not the capability.
    let coverage = own;
    if (documentationLink(control)) {
      score *= 0.6;
      coverage *= 0.6;
    }
    if (score <= 0 || score < minScore) continue;
    matches.push({ control, page: { route: control.route, title: titles.get(control.route) ?? "" }, score, coverage });
  }
  // The same control sits on many pages (a footer link, a nav item); one entry per identity is
  // enough for a search, and the planner picks the page it is nearest on.
  const seen = new Set<string>();
  return matches
    .sort(
      (a, b) =>
        b.coverage - a.coverage || b.score - a.score || a.control.name.length - b.control.name.length,
    )
    .filter((match) => {
      if (seen.has(match.control.key)) return false;
      seen.add(match.control.key);
      return true;
    })
    .slice(0, limit);
}

/** How many pages and controls a search covered, for the evidence line of an absence proof. */
export function graphSize(graph: SiteGraph): { pages: number; controls: number } {
  return { pages: graph.pages.length, controls: graph.controls.length };
}

/**
 * Checks a route plan against the graph: every control is on its page, and each step is linked to
 * the next by a transition. The model never writes these, but a stale graph can, so the check is
 * on the plan and not on who made it.
 */
export function validateRoute(steps: readonly RouteStep[], graph: SiteGraph): boolean {
  if (steps.length === 0 || steps.length > MAX_ROUTE_STEPS) return false;
  const index = byKey(graph);
  for (let position = 0; position < steps.length; position += 1) {
    const step = steps[position] as RouteStep;
    const key = controlKey(step.control);
    const control = controlAt(index, step.control.route, key);
    if (!control || !sameControl(control, step.control)) return false;
    const next = steps[position + 1];
    if (!next) continue;
    const linked =
      next.control.route === step.control.route ||
      graph.transitions.some(
        (transition) =>
          transition.kind === "navigation" &&
          transition.from === step.control.route &&
          transition.key === key &&
          transition.to === next.control.route,
      );
    if (!linked) return false;
  }
  return true;
}
