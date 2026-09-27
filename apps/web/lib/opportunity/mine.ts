/**
 * Steps 2 and 3 of the evidence loop: mine the sessions, attach the replays.
 *
 * One HogQL query returns every successful seat-map session in the window as one row with its
 * ordered steps, and one more returns the two headline numbers. The rows are parsed into the
 * compiler's trajectory shape here and cached by the caller, so a re-run never asks PostHog
 * twice for the same session. Nothing in this file knows what the sessions mean.
 */
import type { Trajectory } from "@lantern/capability";
import type { PosthogClient, QueryResult } from "../posthog/client";
import { headlineQuery, trajectoryQuery } from "../posthog/hogql";
import { toTrajectories } from "../posthog/trajectories";

export type Headline = {
  matchingSessions: number;
  /** Every manual step, scanning included: the compiler's count. */
  medianManualActions: number | null;
  /** The product's own count from the committing event: seat clicks, refused clicks, passenger picks. */
  medianInteractions: number | null;
};

export type QueryRecord = { name: string; rows: number; durationMs: number; cached: boolean };

export type MineOptions = { windowDays: number; limit: number };

export type MineResult = {
  trajectories: Trajectory[];
  headline: Headline | null;
  queries: QueryRecord[];
};

export const TRAJECTORY_QUERY_NAME = "lantern_trajectories";
export const HEADLINE_QUERY_NAME = "lantern_headline";

function cell(result: QueryResult, column: string): unknown {
  const index = result.columns.indexOf(column);
  return index === -1 ? undefined : result.results[0]?.[index];
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

/** The headline row, or null when the query returned nothing. */
export function headlineOf(result: QueryResult): Headline | null {
  if (result.results.length === 0) return null;
  return {
    matchingSessions: numberOrNull(cell(result, "matching_sessions")) ?? 0,
    medianManualActions: numberOrNull(cell(result, "median_manual_actions")),
    medianInteractions: numberOrNull(cell(result, "median_interactions")),
  };
}

function record(name: string, result: QueryResult): QueryRecord {
  return { name, rows: result.results.length, durationMs: result.durationMs, cached: result.cached };
}

/** The session rows and the headline numbers: two queries, run once per opportunity. */
export async function mineTrajectories(posthog: PosthogClient, options: MineOptions): Promise<MineResult> {
  const rows = await posthog.query(TRAJECTORY_QUERY_NAME, trajectoryQuery(options));
  const trajectories = toTrajectories(rows.columns, rows.results);
  const headline = await posthog.query(HEADLINE_QUERY_NAME, headlineQuery(options));
  return {
    trajectories,
    headline: headlineOf(headline),
    queries: [record(TRAJECTORY_QUERY_NAME, rows), record(HEADLINE_QUERY_NAME, headline)],
  };
}

export type ReplayResult = { linked: number; checked: number; failed: number };

/**
 * Builds the "watch this session" link for every trajectory and keeps it only when PostHog
 * confirms a recording exists, so the console never offers a link that opens on nothing. The
 * lookups run a few at a time: the recording endpoint allows 240 calls a minute.
 */
export async function attachReplays(
  trajectories: Trajectory[],
  posthog: PosthogClient,
  options: { concurrency?: number } = {},
): Promise<ReplayResult> {
  const result: ReplayResult = { linked: 0, checked: 0, failed: 0 };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < trajectories.length) {
      const trajectory = trajectories[next++] as Trajectory;
      result.checked += 1;
      try {
        if (await posthog.recordingExists(trajectory.session_id)) {
          trajectory.replay_url = posthog.replayUrl(trajectory.session_id);
          result.linked += 1;
        } else {
          delete trajectory.replay_url;
        }
      } catch {
        result.failed += 1;
      }
    }
  };
  const limit = Math.max(1, Math.min(options.concurrency ?? 4, trajectories.length || 1));
  await Promise.all(Array.from({ length: limit }, worker));
  return result;
}
