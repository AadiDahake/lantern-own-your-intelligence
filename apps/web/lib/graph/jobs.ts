/**
 * Exploration as a job: the queue.
 *
 * A headless browser cannot run inside a serverless function, so the console's route only writes
 * a job row and answers. A process on a machine with a browser claims the row and does the work:
 * the forge runner (`npm run forge:runner`) or `npm run explore`. The console polls the row and
 * the graph tables, so it sees the pages appear as they are read.
 *
 * This module is every read and write of the job row and nothing else, because the route imports
 * it and a function is deployed with all that its imports reach. The explorer is a type here and
 * never a value: `./run-exploration` is the part that needs the browser, and
 * `test/route-imports.test.ts` fails when anything under `app/` reaches it.
 */
import { serviceClient } from "../supabase";
import type { ExploreSummary } from "./explorer";

export type ExploreJobStatus = "queued" | "running" | "done" | "failed";

export type ExploreJob = {
  id: string;
  projectId: string;
  siteUrl: string;
  status: ExploreJobStatus;
  summary: ExploreSummary | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const COLUMNS = "id, project_id, site_url, status, summary, error, created_at, started_at, finished_at";

function toJob(row: Record<string, unknown>): ExploreJob {
  const status = String(row.status);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    siteUrl: String(row.site_url),
    status: status === "running" || status === "done" || status === "failed" ? status : "queued",
    summary: (row.summary as ExploreSummary | null) ?? null,
    error: row.error === null || row.error === undefined ? null : String(row.error),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

/** The job the console is watching: the newest one for the project. */
export async function latestExploration(projectId: string): Promise<ExploreJob | null> {
  const { data } = await serviceClient()
    .from("site_explore_job")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toJob(data as Record<string, unknown>) : null;
}

/**
 * Queues an exploration. A job already queued or running for the project is returned instead of
 * a second one: one browser over the site at a time is enough.
 */
export async function enqueueExploration(projectId: string, siteUrl: string): Promise<ExploreJob> {
  const current = await latestExploration(projectId);
  if (current && (current.status === "queued" || current.status === "running")) return current;
  const { data, error } = await serviceClient()
    .from("site_explore_job")
    .insert({ project_id: projectId, site_url: siteUrl })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`The exploration could not be queued: ${error?.message ?? "no row"}`);
  return toJob(data as Record<string, unknown>);
}

/** Starts a job this process is about to run itself, so the console can watch it. */
export async function startExploration(projectId: string, siteUrl: string): Promise<ExploreJob> {
  const { data, error } = await serviceClient()
    .from("site_explore_job")
    .insert({ project_id: projectId, site_url: siteUrl, status: "running", started_at: new Date().toISOString() })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`The exploration could not be recorded: ${error?.message ?? "no row"}`);
  return toJob(data as Record<string, unknown>);
}

/** Claims the oldest queued job, or null when there is none. Safe for several runners at once. */
export async function claimQueuedExploration(): Promise<ExploreJob | null> {
  const { data, error } = await serviceClient().rpc("claim_site_explore_job");
  if (error) throw new Error(`The exploration queue could not be read: ${error.message}`);
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return rows.length > 0 ? toJob(rows[0] as Record<string, unknown>) : null;
}

/** Records that a claimed job reached the end, with what the explorer found. */
export async function finishExploration(job: ExploreJob, summary: ExploreSummary): Promise<ExploreJob> {
  const { data } = await serviceClient()
    .from("site_explore_job")
    .update({ status: "done", summary, error: null, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .select(COLUMNS)
    .single();
  return data ? toJob(data as Record<string, unknown>) : { ...job, status: "done", summary };
}

/** Records that a claimed job stopped, with the reason the console shows on the row. */
export async function failExploration(job: ExploreJob, message: string): Promise<ExploreJob> {
  await serviceClient()
    .from("site_explore_job")
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", job.id);
  return { ...job, status: "failed", error: message };
}
