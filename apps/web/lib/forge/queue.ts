/**
 * The forge queue: the rows a route writes, and the work a long-lived runner picks up.
 *
 * A forge run is minutes of sandbox work and an approval waits on a merge and a deployment, so
 * neither fits inside a serverless function. The console's routes therefore only write the
 * escalation row and answer; `npm run forge:runner` (`apps/web/scripts/forge-runner.ts`) polls
 * for those rows and carries the work in a process with no time limit. This is the same shape the
 * `local` engine has always had, where `services/worker/local_runner.py` polls the same table.
 *
 * Two queues live on the `escalation` table:
 *
 * - A run to build: `engine='forge'`, `status='queued'`, and a `capability_ir` to build. Claimed
 *   by moving the row to `drafting`, exactly as the Python runner claims a local run.
 * - A decision to carry out: `engine='forge'`, `status` in `approved`/`rejected`, and no
 *   `approval_claimed_at`. Claimed by stamping that column, because a rejection's terminal status
 *   is the status the console already wrote, so there is no transition left to claim it with.
 *
 * A claim is one conditional update, so two runners cannot take the same row.
 */
import { targetProductionUrl, targetVercelProject, vercelTokenIfSet, type ForgeStrategyName } from "../env";
import { appUrl, forgeStrategy } from "../env";
import { serviceClient } from "../supabase";
import { buildForgeDeps, buildStrategy } from "./config";
import { approveForge, runForge, type ForgeRunResult } from "./engine";
import { parseCapabilityIr } from "./ir";
import { targetRepoFor } from "./start";
import { loadCandidates, SupabaseForgeStore } from "./store";

const ESCALATION_COLUMNS =
  "id, project_id, group_id, engine, status, request, capability_ir, capability_spec_id, pr_url, pr_number, winning_candidate_id, approval";

/** One row of either queue, in the shape the executors below read. */
export type ForgeQueueRow = {
  id: string;
  projectId: string;
  groupId: string | null;
  status: string;
  title: string;
  capabilityIr: unknown;
  capabilitySpecId: string | null;
  prUrl: string | null;
  prNumber: number | null;
  winningCandidateId: string | null;
  approval: { approved?: boolean; note?: string } | null;
};

/** Maps an `escalation` row onto the queue shape. */
export function toQueueRow(row: Record<string, unknown>): ForgeQueueRow {
  const request = (row.request ?? null) as { title?: string } | null;
  const approval = (row.approval ?? null) as ForgeQueueRow["approval"];
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    groupId: row.group_id === null || row.group_id === undefined ? null : String(row.group_id),
    status: String(row.status ?? ""),
    title: String(request?.title ?? "Lantern change"),
    capabilityIr: row.capability_ir ?? null,
    capabilitySpecId:
      row.capability_spec_id === null || row.capability_spec_id === undefined ? null : String(row.capability_spec_id),
    prUrl: row.pr_url === null || row.pr_url === undefined ? null : String(row.pr_url),
    prNumber: row.pr_number === null || row.pr_number === undefined ? null : Number(row.pr_number),
    winningCandidateId:
      row.winning_candidate_id === null || row.winning_candidate_id === undefined
        ? null
        : String(row.winning_candidate_id),
    approval,
  };
}

/** The project a queued row belongs to, for the repository it targets. */
async function loadProject(
  projectId: string,
): Promise<{ id: string; repoFullName: string | null; repoDefaultBranch: string | null }> {
  const { data, error } = await serviceClient()
    .from("project")
    .select("id, repo_full_name, repo_default_branch")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? `project ${projectId} is gone`);
  return {
    id: String(data.id),
    repoFullName: data.repo_full_name === null ? null : String(data.repo_full_name),
    repoDefaultBranch: data.repo_default_branch === null ? null : String(data.repo_default_branch),
  };
}

/**
 * Takes the oldest forge run that has a specification to build and marks it `drafting`, so no
 * other runner takes it. Answers null when the queue is empty.
 */
export async function claimQueuedRun(): Promise<ForgeQueueRow | null> {
  const db = serviceClient();
  // The widget also opens `engine='forge'` rows with status 'queued' and no specification. Those
  // are not runnable: the console's forge route is what puts the IR on the row.
  const { data: next } = await db
    .from("escalation")
    .select("id")
    .eq("engine", "forge")
    .eq("status", "queued")
    .not("capability_ir", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return null;

  const { data: claimed } = await db
    .from("escalation")
    .update({ status: "drafting", updated_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "queued")
    .select(ESCALATION_COLUMNS)
    .maybeSingle();
  return claimed ? toQueueRow(claimed as Record<string, unknown>) : null;
}

/**
 * Takes the oldest decided forge run whose decision nobody has carried out yet and stamps the
 * claim. Answers null when there is none.
 */
export async function claimDecidedApproval(): Promise<ForgeQueueRow | null> {
  const db = serviceClient();
  const { data: next } = await db
    .from("escalation")
    .select("id")
    .eq("engine", "forge")
    .in("status", ["approved", "rejected"])
    .is("approval_claimed_at", null)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return null;

  const { data: claimed } = await db
    .from("escalation")
    .update({ approval_claimed_at: new Date().toISOString() })
    .eq("id", next.id)
    .is("approval_claimed_at", null)
    .select(ESCALATION_COLUMNS)
    .maybeSingle();
  return claimed ? toQueueRow(claimed as Record<string, unknown>) : null;
}

/** Builds the capability of a claimed run. Never rejects: a failure is written to the row. */
export async function runClaimedRun(row: ForgeQueueRow, log: (line: string) => void): Promise<ForgeRunResult> {
  const store = new SupabaseForgeStore({ projectId: row.projectId, escalationId: row.id, groupId: row.groupId });
  try {
    const project = await loadProject(row.projectId);
    const repo = await targetRepoFor(project);
    const ir = parseCapabilityIr(row.capabilityIr);
    return await runForge(
      {
        escalationId: row.id,
        ir,
        capabilitySpecId: row.capabilitySpecId,
        repo,
        opportunityUrl: `${appUrl()}/console/activity?escalation=${row.id}`,
        push: true,
      },
      buildForgeDeps(store, { name: forgeStrategy(), log }),
    );
  } catch (error) {
    // runForge reports its own failures; this catches what happens before it can.
    const message = (error as Error).message ?? String(error);
    await store.trace({ kind: "error", status: "failed", title: "Forge failed", detail: { message } });
    await store.updateEscalation({ status: "failed", error: message.slice(0, 2000) });
    return {
      status: "failed",
      winner: null,
      candidates: [],
      previewUrl: null,
      pr: null,
      wouldPush: null,
      error: message,
    };
  }
}

/**
 * Carries out a claimed decision: merge, watch the deployment and tear the winner down, or close
 * the pull request. Never rejects; `approveForge` writes the failure to the row.
 */
export async function runClaimedApproval(row: ForgeQueueRow, log: (line: string) => void): Promise<void> {
  const approved = row.approval?.approved === true;
  const note = row.approval?.note ?? "";
  const store = new SupabaseForgeStore({ projectId: row.projectId, escalationId: row.id, groupId: row.groupId });
  try {
    const project = await loadProject(row.projectId);
    const repo = await targetRepoFor(project);
    const candidates = await loadCandidates(row.id).catch(() => []);
    const winner = candidates.find((candidate) => candidate.id === (row.winningCandidateId ?? "")) ?? null;
    const vercelToken = vercelTokenIfSet();
    await approveForge(
      {
        approved,
        note,
        escalation: { id: row.id, prNumber: row.prNumber, prUrl: row.prUrl, title: row.title },
        winner,
        repo: { fullName: repo.fullName, token: repo.token ?? "" },
        vercel: vercelToken
          ? { token: vercelToken, projectName: targetVercelProject(), productionUrl: targetProductionUrl() }
          : null,
      },
      {
        store,
        strategy: buildStrategy({ name: (winner?.strategy ?? "local") as ForgeStrategyName }).strategy,
        log,
      },
    );
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    log(`approval failed: ${message}`);
    await store.updateEscalation({ status: "failed", error: message.slice(0, 2000) });
  }
}
