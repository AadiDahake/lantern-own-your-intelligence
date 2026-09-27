/**
 * Starting a forge run from the console: the escalation row, the target repository and the
 * specification it will build.
 *
 * The run itself is long (each candidate is three Codex sessions and a test run), so nothing here
 * runs it. The row is the queue: `lib/forge/queue.ts` describes it and `npm run forge:runner`
 * carries it. The route that calls this answers as soon as the row exists.
 */
import type { FeatureRequest, RequestGroup } from "@lantern/shared";
import { attachRun } from "../agent/runner";
import { forgeTargetRepo } from "../env";
import { activeGithubToken } from "../github/connection";
import { serviceClient } from "../supabase";
import { forgeAvailability } from "./config";
import type { CapabilityIr } from "./ir";
import type { TargetRepo } from "./strategy";

export type ForgeProject = {
  id: string;
  repoFullName: string | null;
  repoDefaultBranch: string | null;
};

export type QueuedRun = {
  escalationId: string;
};

export class ForgeStartError extends Error {
  constructor(
    message: string,
    readonly reason: "engine_unavailable" | "no_github_token",
    readonly status: number,
  ) {
    super(message);
    this.name = "ForgeStartError";
  }
}

/** The repository a run targets: the project's, else the configured default. */
export async function targetRepoFor(project: ForgeProject): Promise<TargetRepo> {
  const fullName = project.repoFullName ?? forgeTargetRepo();
  const [owner, name] = fullName.split("/");
  if (!owner || !name) throw new ForgeStartError(`"${fullName}" is not an owner/name repository.`, "no_github_token", 409);
  let token: string;
  try {
    token = await activeGithubToken(project.id);
  } catch (error) {
    throw new ForgeStartError((error as Error).message, "no_github_token", 409);
  }
  return { fullName, owner, name, defaultBranch: project.repoDefaultBranch ?? "main", token };
}

/** The latest compiled specification for a group, or null when the compiler has stored none. */
export async function latestCapabilitySpec(
  groupId: string,
): Promise<{ id: string; spec: unknown } | null> {
  const { data, error } = await serviceClient()
    .from("capability_spec")
    .select("id, spec, version")
    .eq("group_id", groupId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  // The table arrives with the compiler's migration; until then there is simply no stored spec.
  if (error || !data) return null;
  return { id: String(data.id), spec: data.spec };
}

/**
 * Reuses the group's queued forge escalation when the widget already opened one, else inserts a
 * new run. Either way the group points at it from here, and the row carries the specification:
 * that is what makes it runnable for the runner, which skips a queued forge row without one.
 */
async function escalationFor(
  project: ForgeProject,
  group: RequestGroup,
  specId: string | null,
  ir: CapabilityIr,
): Promise<string> {
  const db = serviceClient();
  const { data: queued } = await db
    .from("escalation")
    .select("id")
    .eq("group_id", group.id)
    .eq("engine", "forge")
    .eq("status", "queued")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let escalationId = queued ? String(queued.id) : null;

  if (!escalationId) {
    const request: FeatureRequest = {
      title: group.title,
      description: group.description,
      area: group.area,
      quote: "",
      rationale: `${group.reportCount} conversations reached this gap.`,
    };
    const { data, error } = await db
      .from("escalation")
      .insert({
        project_id: project.id,
        group_id: group.id,
        mode: "full",
        request,
        engine: "forge",
        status: "queued",
        capability_spec_id: specId,
        capability_ir: ir,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "the run could not be recorded");
    escalationId = String(data.id);
  } else {
    await db
      .from("escalation")
      .update({ capability_ir: ir, ...(specId ? { capability_spec_id: specId } : {}) })
      .eq("id", escalationId);
  }
  await attachRun(group.id, escalationId, "drafting");
  return escalationId;
}

/**
 * Records a forge run and leaves it queued for the runner.
 *
 * Everything that can refuse the run happens here, before a row exists: the strategy's keys and
 * the target repository's token. What is left is minutes of sandbox work, which no serverless
 * function can hold, so the runner takes it from the row.
 */
export async function enqueueForgeRun(input: {
  project: ForgeProject;
  group: RequestGroup;
  ir: CapabilityIr;
  capabilitySpecId: string | null;
}): Promise<QueuedRun> {
  const availability = forgeAvailability();
  if (!availability.ok) throw new ForgeStartError(availability.reason, "engine_unavailable", 503);
  await targetRepoFor(input.project);
  const escalationId = await escalationFor(input.project, input.group, input.capabilitySpecId, input.ir);
  return { escalationId };
}
