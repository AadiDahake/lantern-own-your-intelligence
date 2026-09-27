/**
 * Route memory: a route is remembered only after a person walked it to the end, and the next
 * person who asks the same question gets it back with the exact step count and no model call.
 *
 * Lantern owns the store; Memorable has no lookup endpoint. Each completed walk goes to Memorable's
 * `POST /v1/extract` when a key is set, and the draft it returns is kept beside the route. The
 * store is one JSON file per project on the machine that runs the app, keyed by the question's
 * intent key (`lib/graph/intent.ts`), so a lookup is exact and needs no model and no embedding.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { controlKey } from "@lantern/shared";
import { memorableApiKey, memorableApiUrl, routeMemoryDir, routeMemoryMode, type RouteMemoryMode } from "../env";
import { intentKey } from "../graph/intent";
import type { KnownRoute } from "../graph/store";
import { extract, traceFor, type Extraction, type WalkStep } from "./memorable";

export type { WalkStep } from "./memorable";

export type RememberedRoute = {
  intent: string;
  /** The wording that was confirmed first. */
  question: string;
  feature: string;
  answer: string;
  steps: WalkStep[];
  /** How many walks of this route reached the end. */
  walks: number;
  /** True when Memorable extracted a procedure from the walk. */
  extracted: boolean;
  title: string | null;
  draft: unknown;
  firstConfirmed: string;
  lastUsed: string;
};

export type RememberInput = { walkId: string; feature: string; answer: string; steps: WalkStep[] };

export type RememberResult =
  | { status: "remembered"; route: RememberedRoute; extraction: Extraction | null }
  | { status: "skipped"; reason: string };

export type RouteMemoryOptions = {
  mode?: RouteMemoryMode;
  dir?: string;
  apiKey?: string | null;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type StoreFile = { routes: Record<string, RememberedRoute> };

function storeDir(options: RouteMemoryOptions): string {
  return resolve(/*turbopackIgnore: true*/ options.dir ?? routeMemoryDir() ?? join(tmpdir(), "lantern-route-memory"));
}

function storePath(projectId: string, options: RouteMemoryOptions): string {
  // The project id is a uuid; anything else is reduced to a safe file name.
  return join(storeDir(options), `${projectId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

async function load(projectId: string, options: RouteMemoryOptions): Promise<StoreFile> {
  try {
    const parsed = JSON.parse(await readFile(storePath(projectId, options), "utf8")) as Partial<StoreFile>;
    return { routes: parsed.routes && typeof parsed.routes === "object" ? parsed.routes : {} };
  } catch {
    return { routes: {} };
  }
}

async function save(projectId: string, file: StoreFile, options: RouteMemoryOptions): Promise<void> {
  const path = storePath(projectId, options);
  await mkdir(storeDir(options), { recursive: true });
  // Write then rename, so a reader never sees half a file.
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(file, null, 2), "utf8");
  await rename(temporary, path);
}

/** A step the store can keep: it names a control and the route that control lives on. */
function isWalkStep(value: unknown): value is WalkStep {
  if (typeof value !== "object" || value === null) return false;
  const step = value as Record<string, unknown>;
  const control = step.control as Record<string, unknown> | undefined;
  return (
    typeof step.caption === "string" &&
    (step.advanceOn === "click" || step.advanceOn === "input" || step.advanceOn === "navigation" || step.advanceOn === "manual") &&
    typeof control === "object" &&
    control !== null &&
    typeof control.role === "string" &&
    typeof control.name === "string" &&
    typeof control.route === "string"
  );
}

/** Keeps only what the store needs from each step, and drops the walk when a step is not usable. */
export function walkSteps(value: unknown): WalkStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  if (!value.every(isWalkStep)) return null;
  return value.map((step) => {
    const control: WalkStep["control"] = { role: step.control.role, name: step.control.name.slice(0, 200), route: step.control.route };
    if (typeof step.control.landmark === "string") control.landmark = step.control.landmark;
    if (typeof step.control.href === "string") control.href = step.control.href;
    return { caption: step.caption.slice(0, 300), advanceOn: step.advanceOn, control };
  });
}

/** The remembered route for a question, or null. Always null when route memory is off. */
export async function recallRoute(
  projectId: string,
  question: string,
  options: RouteMemoryOptions = {},
): Promise<RememberedRoute | null> {
  if ((options.mode ?? routeMemoryMode()) === "off") return null;
  const intent = intentKey(question);
  if (!intent) return null;
  return (await load(projectId, options)).routes[intent] ?? null;
}

/**
 * Remembers a walk that reached its last step. A second completed walk of the same route counts
 * as one more confirmation; a different route for the same question replaces the old one.
 */
export async function rememberRoute(
  projectId: string,
  question: string,
  input: RememberInput,
  options: RouteMemoryOptions = {},
): Promise<RememberResult> {
  const mode = options.mode ?? routeMemoryMode();
  if (mode === "off") return { status: "skipped", reason: "route memory is off" };
  const intent = intentKey(question);
  if (!intent) return { status: "skipped", reason: "the question names no concept" };
  if (input.steps.length === 0) return { status: "skipped", reason: "the walk has no steps" };

  let extraction: Extraction | null = null;
  const apiKey = options.apiKey !== undefined ? options.apiKey : memorableApiKey();
  if (mode === "memorable" && apiKey) {
    extraction = await extract(traceFor({ walkId: input.walkId, question, steps: input.steps }), {
      apiKey,
      baseUrl: options.apiUrl ?? memorableApiUrl(),
      fetchImpl: options.fetchImpl,
    });
    // A walk that only opens pages is refused as `read_only`; the route is still worth keeping.
    if (extraction.status === "refused" && extraction.reason !== "read_only") {
      return { status: "skipped", reason: `Memorable refused the walk: ${extraction.reason}` };
    }
  }

  const now = (options.now ?? (() => new Date()))().toISOString();
  const file = await load(projectId, options);
  const earlier = file.routes[intent];
  const sameRoute = earlier && JSON.stringify(earlier.steps) === JSON.stringify(input.steps);
  const extracted = extraction?.status === "extracted";
  const route: RememberedRoute = {
    intent,
    question: sameRoute ? earlier.question : question,
    feature: input.feature,
    answer: input.answer,
    steps: input.steps,
    walks: sameRoute ? earlier.walks + 1 : 1,
    extracted: extracted || Boolean(sameRoute && earlier.extracted),
    title: extraction?.status === "extracted" ? extraction.title : sameRoute ? earlier.title : null,
    draft: extraction?.status === "extracted" ? extraction.draft : sameRoute ? earlier.draft : null,
    firstConfirmed: sameRoute ? earlier.firstConfirmed : now,
    lastUsed: now,
  };
  file.routes[intent] = route;
  await save(projectId, file, options);
  return { status: "remembered", route, extraction };
}

/**
 * A remembered route in the shape the known-route answer takes. The target is the control the
 * walk ended on; the turn plans from the visitor's page to it over the product map, so the count
 * is exact from wherever they are and no model is asked.
 */
export function rememberedAsKnown(route: RememberedRoute): KnownRoute {
  const last = route.steps[route.steps.length - 1] as WalkStep;
  const { route: path, ...ref } = last.control;
  return {
    id: `memory:${route.intent}`,
    intent: route.intent,
    feature: route.feature,
    question: route.question,
    target: { route: path, key: controlKey(ref) },
    answer: route.answer,
    sources: [],
    hitCount: route.walks,
    similarity: null,
  };
}
