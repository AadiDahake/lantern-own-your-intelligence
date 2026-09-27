/**
 * Starts a forge run for an opportunity.
 *
 * The specification is the group's latest compiled capability spec. While the compiler has not
 * stored one, the body may carry it as `spec`. The route refuses before writing anything when the
 * configured strategy cannot run, and answers `202` as soon as the queued row exists.
 *
 * The run itself is minutes of sandbox work, which is longer than any serverless function may
 * live, so this route never runs it: `npm run forge:runner` claims the row and carries it. See
 * `lib/forge/queue.ts` and the "Where a run actually runs" section of `docs/forge.md`.
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { toRequestGroup } from "@/lib/console/groups";
import { parseCapabilityIr } from "@/lib/forge/ir";
import { enqueueForgeRun, ForgeStartError, latestCapabilitySpec } from "@/lib/forge/start";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GROUP_COLUMNS =
  "id, title, description, area, report_count, user_report_count, priority, status, issue_url, issue_number, pr_url, escalation_id, first_seen, last_seen";

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { groupId } = await context.params;
  const { data: row } = await serviceClient()
    .from("feature_request_group")
    .select(GROUP_COLUMNS)
    .eq("id", groupId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!row) return corsJson({ error: "not found" }, { status: 404 });
  const group = toRequestGroup(row as Record<string, unknown>);

  const body = (await request.json().catch(() => ({}))) as { spec?: unknown };
  let specId: string | null = null;
  let specInput: unknown = body.spec;
  if (specInput === undefined) {
    const stored = await latestCapabilitySpec(group.id);
    if (!stored) {
      return corsJson(
        { error: "This opportunity has no compiled capability specification yet.", reason: "no_capability_spec" },
        { status: 409 },
      );
    }
    specId = stored.id;
    specInput = stored.spec;
  }

  try {
    const ir = parseCapabilityIr(specInput);
    const queued = await enqueueForgeRun({
      project: {
        id: project.id,
        repoFullName: project.repoFullName,
        repoDefaultBranch: project.repoDefaultBranch,
      },
      group,
      ir,
      capabilitySpecId: specId,
    });
    return corsJson({ escalationId: queued.escalationId, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof ForgeStartError) {
      return corsJson({ error: error.message, reason: error.reason }, { status: error.status });
    }
    if (error instanceof Error && error.message.startsWith("Capability IR:")) {
      return corsJson({ error: error.message, reason: "invalid_spec" }, { status: 400 });
    }
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
