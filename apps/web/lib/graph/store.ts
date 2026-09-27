/**
 * Reading and writing the site graph.
 *
 * One project's graph is one document: the pages the site has, the controls on each, and the
 * transitions between them. It is read whole because the planner needs all of it, and cached for
 * a few seconds because a walk asks for it on every page. Writes go through the SQL functions of
 * migration 0015, one round trip per scan.
 */
import { controlKey, controlRefOf, routeOf } from "@lantern/shared";
import type { AnswerSource, PageContext, SiteGraph } from "@lantern/shared";
import { serviceClient } from "../supabase";

/** A control as the console lists it: the graph shape plus when it was seen. */
export type StoredControl = SiteGraph["controls"][number] & {
  id: string;
  seenCount: number;
  lastSeen: string;
};

export type StoredPage = SiteGraph["pages"][number] & {
  source: string;
  firstSeen: string;
  lastSeen: string;
};

export type StoredTransition = SiteGraph["transitions"][number] & {
  source: string;
  seenCount: number;
  lastSeen: string;
};

/** The graph with its bookkeeping, for the console. The planner only reads the graph part. */
export type StoredGraph = {
  pages: StoredPage[];
  controls: StoredControl[];
  transitions: StoredTransition[];
};

export type ScanSource = "explorer" | "widget";

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; graph: StoredGraph }>();

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toStoredGraph(raw: unknown): StoredGraph {
  const document = (raw ?? {}) as Record<string, unknown>;
  const pages = Array.isArray(document.pages) ? (document.pages as Record<string, unknown>[]) : [];
  const controls = Array.isArray(document.controls) ? (document.controls as Record<string, unknown>[]) : [];
  const transitions = Array.isArray(document.transitions)
    ? (document.transitions as Record<string, unknown>[])
    : [];
  return {
    pages: pages.map((page) => ({
      route: asString(page.route, "/"),
      url: asString(page.url),
      title: asString(page.title),
      source: asString(page.source, "widget"),
      firstSeen: asString(page.firstSeen),
      lastSeen: asString(page.lastSeen),
    })),
    controls: controls.map((control) => {
      const stored: StoredControl = {
        id: asString(control.id),
        route: asString(control.route, "/"),
        key: asString(control.key),
        role: asString(control.role),
        name: asString(control.name),
        visible: control.visible !== false,
        seenCount: typeof control.seenCount === "number" ? control.seenCount : 1,
        lastSeen: asString(control.lastSeen),
      };
      if (typeof control.landmark === "string" && control.landmark) stored.landmark = control.landmark;
      if (typeof control.href === "string" && control.href) stored.href = control.href;
      return stored;
    }),
    transitions: transitions.map((transition) => {
      const stored: StoredTransition = {
        from: asString(transition.from, "/"),
        key: asString(transition.key),
        to: asString(transition.to, "/"),
        kind: transition.kind === "reveal" ? "reveal" : "navigation",
        source: asString(transition.source, "widget"),
        seenCount: typeof transition.seenCount === "number" ? transition.seenCount : 1,
        lastSeen: asString(transition.lastSeen),
      };
      if (typeof transition.reveals === "string" && transition.reveals) stored.reveals = transition.reveals;
      return stored;
    }),
  };
}

/** The project's whole graph. Cached briefly, because one walk reads it on every page. */
export async function loadGraph(projectId: string): Promise<StoredGraph> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.graph;
  const { data, error } = await serviceClient().rpc("site_graph", { filter_project: projectId });
  if (error) throw new Error(`The site graph could not be read: ${error.message}`);
  const graph = toStoredGraph(data);
  cache.set(projectId, { at: Date.now(), graph });
  return graph;
}

/** Drops the cached copy, so the next read sees what was just written. */
export function forgetGraph(projectId: string): void {
  cache.delete(projectId);
}

/** One control as the scan function takes it. */
export type ControlRow = {
  key: string;
  role: string;
  name: string;
  landmark: string | null;
  href: string | null;
  visible: boolean;
};

/** Turns a scanned page into the rows the graph keeps: named controls only, keyed by identity. */
export function controlRows(page: PageContext): ControlRow[] {
  const rows = new Map<string, ControlRow>();
  for (const affordance of page.affordances) {
    if (!affordance.name.trim() || affordance.disabled) continue;
    const ref = controlRefOf(affordance, page.url);
    const key = controlKey(ref);
    const existing = rows.get(key);
    if (existing) {
      existing.visible = existing.visible || affordance.visible;
      continue;
    }
    rows.set(key, {
      key,
      role: ref.role,
      name: ref.name,
      landmark: ref.landmark ?? null,
      href: ref.href ?? null,
      visible: affordance.visible,
    });
  }
  return [...rows.values()];
}

/** Records one page as a scan saw it. Returns the route it was stored under. */
export async function recordScan(projectId: string, page: PageContext, source: ScanSource): Promise<string> {
  const route = routeOf(page.url);
  const { error } = await serviceClient().rpc("upsert_site_scan", {
    filter_project: projectId,
    page_route: route,
    page_url: page.url,
    page_title: page.title,
    scan_source: source,
    controls: controlRows(page),
  });
  if (error) throw new Error(`The page scan could not be stored: ${error.message}`);
  forgetGraph(projectId);
  return route;
}

export type TransitionInput = {
  fromRoute: string;
  key: string;
  toRoute: string;
  kind: "navigation" | "reveal";
  reveals?: string;
};

/** Records one move. Both pages must have been recorded already. */
export async function recordTransition(
  projectId: string,
  transition: TransitionInput,
  source: ScanSource,
): Promise<void> {
  const { error } = await serviceClient().rpc("upsert_transition", {
    filter_project: projectId,
    from_route: transition.fromRoute,
    control_key: transition.key,
    to_route: transition.toRoute,
    transition_kind: transition.kind,
    reveals_key: transition.reveals ?? null,
    scan_source: source,
  });
  if (error) throw new Error(`The transition could not be stored: ${error.message}`);
  forgetGraph(projectId);
}

export type KnownRoute = {
  id: string;
  intent: string;
  feature: string;
  question: string;
  target: { route: string; key: string };
  answer: string;
  sources: AnswerSource[];
  hitCount: number;
  similarity: number | null;
};

type KnownRouteRow = {
  id: string;
  intent: string;
  feature: string;
  question: string;
  target_affordance_id: string;
  answer: string;
  sources: unknown;
  hit_count: number;
  similarity?: number;
};

function toSources(value: unknown): AnswerSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      title: asString(entry.title),
      url: typeof entry.url === "string" ? entry.url : null,
    }))
    .filter((entry) => entry.title !== "");
}

async function toKnownRoute(row: KnownRouteRow, graph: StoredGraph): Promise<KnownRoute | null> {
  const control = graph.controls.find((candidate) => candidate.id === row.target_affordance_id);
  if (!control) return null;
  return {
    id: row.id,
    intent: row.intent,
    feature: row.feature,
    question: row.question,
    target: { route: control.route, key: control.key },
    answer: row.answer,
    sources: toSources(row.sources),
    hitCount: row.hit_count,
    similarity: typeof row.similarity === "number" ? row.similarity : null,
  };
}

const KNOWN_ROUTE_COLUMNS = "id, intent, feature, question, target_affordance_id, answer, sources, hit_count";

/** The route a question with exactly these concepts resolved to before. No model, no embedding. */
export async function findKnownRoute(projectId: string, intent: string): Promise<KnownRoute | null> {
  const { data } = await serviceClient()
    .from("known_route")
    .select(KNOWN_ROUTE_COLUMNS)
    .eq("project_id", projectId)
    .eq("intent", intent)
    .maybeSingle();
  if (!data) return null;
  return toKnownRoute(data as KnownRouteRow, await loadGraph(projectId));
}

/** How near a new wording has to be to a stored one to count as the same question. */
export const KNOWN_ROUTE_MATCH = 0.92;

/** The nearest known route by wording, when it is near enough. Costs the embedding the turn already has. */
export async function nearestKnownRoute(projectId: string, embedding: number[]): Promise<KnownRoute | null> {
  const { data, error } = await serviceClient().rpc("match_known_routes", {
    query_embedding: embedding,
    match_count: 1,
    filter_project: projectId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as KnownRouteRow;
  if ((row.similarity ?? 0) < KNOWN_ROUTE_MATCH) return null;
  return toKnownRoute(row, await loadGraph(projectId));
}

/** Notes that a known route was used, so the console can show which questions come back. */
export async function touchKnownRoute(id: string, hitCount: number): Promise<void> {
  await serviceClient()
    .from("known_route")
    .update({ hit_count: hitCount + 1, last_used: new Date().toISOString() })
    .eq("id", id);
}

export type KnownRouteInput = {
  intent: string;
  feature: string;
  question: string;
  target: { route: string; key: string };
  answer: string;
  sources: AnswerSource[];
  embedding: number[] | null;
};

/** Remembers which control a question resolved to. A repeat of the intent replaces the entry. */
export async function saveKnownRoute(projectId: string, input: KnownRouteInput): Promise<void> {
  const graph = await loadGraph(projectId);
  const control = graph.controls.find(
    (candidate) => candidate.route === input.target.route && candidate.key === input.target.key,
  );
  if (!control) return;
  const { error } = await serviceClient()
    .from("known_route")
    .upsert(
      {
        project_id: projectId,
        intent: input.intent,
        feature: input.feature,
        question: input.question,
        target_affordance_id: control.id,
        answer: input.answer,
        sources: input.sources,
        embedding: input.embedding,
        last_used: new Date().toISOString(),
      },
      { onConflict: "project_id,intent" },
    );
  if (error) throw new Error(`The route could not be remembered: ${error.message}`);
}

/** Every known route of a project, most used first, for the console. */
export async function listKnownRoutes(projectId: string): Promise<KnownRoute[]> {
  const { data } = await serviceClient()
    .from("known_route")
    .select(KNOWN_ROUTE_COLUMNS)
    .eq("project_id", projectId)
    .order("hit_count", { ascending: false })
    .limit(100);
  const graph = await loadGraph(projectId);
  const routes: KnownRoute[] = [];
  for (const row of (data ?? []) as KnownRouteRow[]) {
    const route = await toKnownRoute(row, graph);
    if (route) routes.push(route);
  }
  return routes;
}

/** The concepts of a question, sorted and joined: the key a repeat of it is found by. */
export { intentKey } from "./intent";
