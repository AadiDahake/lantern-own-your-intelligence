/** A `PosthogClient` that answers from fixture rows and never reaches the network. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PosthogClient, QueryResult } from "@/lib/posthog/client";
import { HEADLINE_QUERY_NAME, TRAJECTORY_QUERY_NAME } from "@/lib/opportunity/mine";

type Rows = { columns: string[]; results: unknown[][] };

const FIXTURES = join(__dirname, "..", "fixtures", "posthog");

export function loadRows(name: string): Rows {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Rows;
}

/**
 * The compiler's own fixtures, which are 83 sessions in the trajectory shape, turned back into
 * the tuple rows the query returns, so the pipeline test runs over the same evidence the
 * compiler's tests do.
 */
export function rowsFromTrajectories(trajectories: Array<{
  session_id: string;
  distinct_id?: string;
  opened_at: string;
  confirmed_at: string | null;
  duration_seconds: number;
  step_count: number;
  steps: { t: string; event: string; props: Record<string, unknown> }[];
}>): Rows {
  const props = ["seat", "row", "column", "state", "passenger_index", "passenger_type", "price", "reason", "party_size", "current_seats", "flight_id", "reservation_code", "seats", "same_row", "contiguous", "additional_cost", "interactions", "elapsed_ms", "slug"];
  const cell = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    return Array.isArray(value) ? JSON.stringify(value) : String(value);
  };
  return {
    columns: ["session_id", "distinct_id", "opened_at", "confirmed_at", "duration_seconds", "step_count", "steps"],
    results: trajectories
      .filter((t) => t.confirmed_at !== null)
      .map((t) => [
        t.session_id,
        t.distinct_id ?? null,
        t.opened_at,
        t.confirmed_at,
        t.duration_seconds,
        t.step_count,
        t.steps.map((s) => [s.t, s.event, ...props.map((name) => cell(s.props[name]))]),
      ]),
  };
}

export class FakePosthogClient implements PosthogClient {
  readonly queries: string[] = [];
  readonly recordingLookups: string[] = [];
  /** Session ids with no recording. */
  readonly missingRecordings = new Set<string>();
  failQueries = false;

  constructor(
    private readonly rows: { trajectories: Rows; headline: Rows; outcome?: Rows },
  ) {}

  async query(name: string): Promise<QueryResult> {
    this.queries.push(name);
    if (this.failQueries) throw new Error("PostHog query failed with 429");
    const rows =
      name === TRAJECTORY_QUERY_NAME
        ? this.rows.trajectories
        : name === HEADLINE_QUERY_NAME
          ? this.rows.headline
          : (this.rows.outcome ?? { columns: [], results: [] });
    return { columns: rows.columns, results: rows.results, types: [], durationMs: 12, cached: false };
  }

  async recordingExists(sessionId: string): Promise<boolean> {
    this.recordingLookups.push(sessionId);
    return !this.missingRecordings.has(sessionId);
  }

  replayUrl(sessionId: string): string {
    return `https://us.posthog.com/project/1/replay/${sessionId}`;
  }
}
