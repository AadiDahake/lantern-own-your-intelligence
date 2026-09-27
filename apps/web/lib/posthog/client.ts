/**
 * The one place the app talks to PostHog, and the only place that holds the personal API key.
 *
 * Two endpoints: the query endpoint for HogQL, and the session recording endpoint to confirm a
 * replay exists. The replay deep link needs no call at all; it is built from the project id and
 * the session id. Rate limits (240 queries a minute, three concurrent) are the caller's problem
 * to respect: the miner runs two queries per opportunity and caches the rows.
 */
import { posthogHost, posthogPersonalApiKey, posthogProjectId } from "../env";

export type PosthogConfig = {
  host: string;
  projectId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export type QueryResult = {
  columns: string[];
  results: unknown[][];
  types: [string, string][];
  durationMs: number;
  /** PostHog's own cache flag: true when the rows came from a cached run of the same query. */
  cached: boolean;
};

/** What the miner needs from PostHog. The real client below, a fake in the tests. */
export interface PosthogClient {
  query(name: string, hogql: string): Promise<QueryResult>;
  recordingExists(sessionId: string): Promise<boolean>;
  replayUrl(sessionId: string, options?: { atSeconds?: number }): string;
}

export class PosthogError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly queryName: string | null,
  ) {
    super(message);
    this.name = "PosthogError";
  }
}

/** `https://us.posthog.com/project/12345/replay/<session_id>?t=42`. */
export function replayUrl(host: string, projectId: string, sessionId: string, options: { atSeconds?: number } = {}): string {
  const base = `${host.replace(/\/$/, "")}/project/${projectId}/replay/${encodeURIComponent(sessionId)}`;
  return options.atSeconds !== undefined ? `${base}?t=${Math.max(0, Math.floor(options.atSeconds))}` : base;
}

export class HttpPosthogClient implements PosthogClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: PosthogConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private get base(): string {
    return `${this.config.host.replace(/\/$/, "")}/api/projects/${this.config.projectId}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" };
  }

  /**
   * One HogQL query, blocking, named. The name lands in PostHog's `query_log`, which is the only
   * way to tell Lantern's queries apart when one is slow.
   */
  async query(name: string, hogql: string): Promise<QueryResult> {
    // The monotonic clock: a wall-clock correction mid-query would make the duration negative.
    const started = performance.now();
    const response = await this.fetchImpl(`${this.base}/query/`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql }, name, refresh: "blocking" }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new PosthogError(`PostHog query ${name} failed with ${response.status}: ${text.slice(0, 300)}`, response.status, name);
    }
    const body = JSON.parse(text) as {
      columns?: unknown;
      results?: unknown;
      types?: unknown;
      is_cached?: unknown;
    };
    return {
      columns: Array.isArray(body.columns) ? body.columns.map(String) : [],
      results: Array.isArray(body.results) ? (body.results as unknown[][]) : [],
      types: Array.isArray(body.types) ? (body.types as [string, string][]) : [],
      durationMs: Math.round(performance.now() - started),
      cached: body.is_cached === true,
    };
  }

  /** The recording id is the session id, so a 200 here means "watch this session" will work. */
  async recordingExists(sessionId: string): Promise<boolean> {
    const response = await this.fetchImpl(`${this.base}/session_recordings/${encodeURIComponent(sessionId)}/`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new PosthogError(`PostHog recording lookup failed with ${response.status}`, response.status, null);
    }
    return true;
  }

  replayUrl(sessionId: string, options: { atSeconds?: number } = {}): string {
    return replayUrl(this.config.host, this.config.projectId, sessionId, options);
  }
}

/** The client wired from the environment. Built per call; it holds no connection. */
export function posthogClient(): HttpPosthogClient {
  return new HttpPosthogClient({
    host: posthogHost(),
    projectId: posthogProjectId(),
    apiKey: posthogPersonalApiKey(),
  });
}
