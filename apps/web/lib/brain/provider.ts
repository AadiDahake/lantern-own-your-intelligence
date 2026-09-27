/**
 * The company brain as the turn reads it: one search over a GBrain workspace.
 *
 * A brain that is not configured says so and is never called. One that is configured either
 * answers inside its time limit or throws, and the caller decides what a failure means; for the
 * documentation check it means the present search answers instead.
 */
import { brainWorkspace, type BrainWorkspace } from "./config";
import { callTool } from "./mcp";

/** One passage the brain found, with the page it came from. */
export type BrainHit = {
  title: string;
  /** The page type the brain holds it under. */
  type: string;
  snippet: string;
  /** The brain's rank score. It orders the hits and is not a similarity. */
  score: number;
  /** Cosine similarity of the passage to the query, when the brain measured one. */
  cosine: number | null;
  /** How the brain matched it, for example `keyword_exact` or `weak_semantic`. */
  evidence: string | null;
  source: { slug: string; sourceId: string; part: string | null };
};

export type BrainSearch =
  | { configured: false; reason: "not configured" }
  | { configured: true; hits: BrainHit[]; latencyMs: number };

export type BrainSearchOptions = {
  limit?: number;
  /** Keep only pages whose slug starts with this, for example `help/`. */
  prefix?: string;
  snippetChars?: number;
  timeoutMs?: number;
  /** The workspace to search. Left out, it is read from the environment. */
  workspace?: BrainWorkspace | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toHit(value: unknown): BrainHit | null {
  if (!isRecord(value) || typeof value.slug !== "string" || value.slug === "") return null;
  return {
    title: typeof value.title === "string" ? value.title : value.slug,
    type: typeof value.type === "string" ? value.type : "",
    snippet: typeof value.chunk_text === "string" ? value.chunk_text : "",
    score: typeof value.score === "number" && Number.isFinite(value.score) ? value.score : 0,
    cosine: typeof value.cosine === "number" && Number.isFinite(value.cosine) ? value.cosine : null,
    evidence: typeof value.evidence === "string" ? value.evidence : null,
    source: {
      slug: value.slug,
      sourceId: typeof value.source_id === "string" ? value.source_id : "",
      part: typeof value.chunk_source === "string" ? value.chunk_source : null,
    },
  };
}

/** Searches the company brain. Throws when the brain is configured and does not answer. */
export async function searchBrain(query: string, options: BrainSearchOptions = {}): Promise<BrainSearch> {
  const workspace = options.workspace === undefined ? brainWorkspace() : options.workspace;
  if (!workspace) return { configured: false, reason: "not configured" };

  const started = Date.now();
  const limit = options.limit ?? 6;
  const found = await callTool(
    workspace,
    "search",
    // A prefix is applied after the search, so more is asked for than will be kept.
    { query, limit: options.prefix ? limit * 3 : limit, snippet_chars: options.snippetChars ?? 600 },
    options.timeoutMs ?? 1_500,
  );
  const rows = Array.isArray(found) ? found : isRecord(found) && Array.isArray(found.results) ? found.results : [];
  const prefix = options.prefix ?? "";
  const hits = rows
    .flatMap((row) => {
      const hit = toHit(row);
      return hit && hit.source.slug.startsWith(prefix) ? [hit] : [];
    })
    .slice(0, limit);
  return { configured: true, hits, latencyMs: Date.now() - started };
}
