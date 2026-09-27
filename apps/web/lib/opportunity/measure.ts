/**
 * Step 19 of the evidence loop: PostHog's second job, did the change help?
 *
 * One query over the outcome events a shipped capability reports. The row is labelled from the
 * data itself: when every event in the window carries `seeded: true` the source is `seeded`,
 * which is what the demo's 30-days-later card must say; real events make it `posthog`.
 */
import { posthogWindowDays } from "../env";
import { posthogClient, type PosthogClient, type QueryResult } from "../posthog/client";
import { outcomeQuery } from "../posthog/hogql";
import { serviceClient } from "../supabase";
import { emitTrace } from "../trace";
import { toOutcome } from "./read";
import type { DeploymentOutcome } from "@lantern/shared";

export const OUTCOME_QUERY_NAME = "lantern_outcome";

export type OutcomeFigures = {
  eligible: number | null;
  used: number | null;
  succeeded: number | null;
  medianActionsAfter: number | null;
  supportBefore: number | null;
  supportAfter: number | null;
  supportChangePct: number | null;
  source: "seeded" | "posthog";
  events: number;
};

function cell(result: QueryResult, column: string): number | null {
  const index = result.columns.indexOf(column);
  const value = index === -1 ? undefined : result.results[0]?.[index];
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

/** The figures from one outcome query result. Null when no outcome events exist yet. */
export function figuresOf(result: QueryResult): OutcomeFigures | null {
  const events = cell(result, "total_events") ?? 0;
  if (events === 0) return null;
  const before = cell(result, "support_before");
  const after = cell(result, "support_after");
  const seeded = cell(result, "seeded_events") ?? 0;
  return {
    eligible: cell(result, "eligible"),
    used: cell(result, "used"),
    succeeded: cell(result, "succeeded"),
    medianActionsAfter: cell(result, "median_actions_after"),
    supportBefore: before,
    supportAfter: after,
    supportChangePct: before && after !== null ? Math.round(((after - before) / before) * 1000) / 10 : null,
    source: seeded === events ? "seeded" : "posthog",
    events,
  };
}

export async function queryOutcome(posthog: PosthogClient, intent: string, windowDays: number): Promise<OutcomeFigures | null> {
  return figuresOf(await posthog.query(OUTCOME_QUERY_NAME, outcomeQuery({ intent, windowDays })));
}

/**
 * Measures the capability's outcome and stores a `deployment_outcome` row. `medianBefore` is
 * the product's own interaction count over the sessions that worked around the gap, so the
 * before and after compare the same measure.
 */
export async function measureOutcome(input: {
  projectId: string;
  groupId: string;
  intent: string;
  medianBefore: number | null;
  posthog?: PosthogClient;
  windowDays?: number;
}): Promise<{ outcome: DeploymentOutcome; figures: OutcomeFigures } | null> {
  const windowDays = input.windowDays ?? posthogWindowDays();
  const figures = await queryOutcome(input.posthog ?? posthogClient(), input.intent, windowDays);
  if (!figures) return null;

  const { data, error } = await serviceClient()
    .from("deployment_outcome")
    .insert({
      project_id: input.projectId,
      group_id: input.groupId,
      window_days: windowDays,
      eligible_users: figures.eligible,
      feature_used: figures.used,
      feature_succeeded: figures.succeeded,
      median_actions_before: input.medianBefore,
      median_actions_after: figures.medianActionsAfter,
      support_change_pct: figures.supportChangePct,
      source: figures.source,
    })
    .select("id, group_id, measured_at, window_days, eligible_users, feature_used, feature_succeeded, median_actions_before, median_actions_after, support_change_pct, source")
    .single();
  if (error || !data) throw new Error(error?.message ?? "the outcome could not be stored");
  const outcome = toOutcome(data as Record<string, unknown>);

  await emitTrace({
    projectId: input.projectId,
    groupId: input.groupId,
    source: "forge",
    kind: "artifact",
    status: "ok",
    title: `${windowDays}-day outcome (${figures.source})`,
    detail: {
      artifact: "outcome",
      source: figures.source,
      intent: input.intent,
      eligible: figures.eligible,
      used: figures.used,
      succeeded: figures.succeeded,
      median_actions_before: input.medianBefore,
      median_actions_after: figures.medianActionsAfter,
      support_before: figures.supportBefore,
      support_after: figures.supportAfter,
      support_change_pct: figures.supportChangePct,
    },
  });
  return { outcome, figures };
}
