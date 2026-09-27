/** One forge run: the escalation and every candidate with its state. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadCandidates } from "@/lib/forge/store";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ escalationId: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { escalationId } = await context.params;
  const { data } = await serviceClient()
    .from("escalation")
    .select(
      "id, engine, status, pr_url, pr_number, branch, deployment_url, winning_candidate_id, capability_spec_id, error, approval, created_at, updated_at",
    )
    .eq("id", escalationId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!data) return corsJson({ error: "not found" }, { status: 404 });

  try {
    const candidates = await loadCandidates(escalationId);
    return corsJson({
      escalation: {
        id: String(data.id),
        engine: String(data.engine),
        status: String(data.status),
        prUrl: data.pr_url === null ? null : String(data.pr_url),
        prNumber: data.pr_number === null ? null : Number(data.pr_number),
        branch: data.branch === null ? null : String(data.branch),
        deploymentUrl: data.deployment_url === null ? null : String(data.deployment_url),
        winningCandidateId: data.winning_candidate_id === null ? null : String(data.winning_candidate_id),
        capabilitySpecId: data.capability_spec_id === null ? null : String(data.capability_spec_id),
        approval: data.approval ?? null,
        error: data.error === null ? null : String(data.error),
        createdAt: String(data.created_at),
        updatedAt: data.updated_at === null ? null : String(data.updated_at),
      },
      candidates,
    });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
