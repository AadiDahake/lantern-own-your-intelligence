/**
 * Measures a shipped capability's outcome from PostHog and stores the row. The row's source
 * says whether the figures were measured or seeded; the console shows that label.
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { posthogConfigured } from "@/lib/env";
import { measureOutcome } from "@/lib/opportunity/measure";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { groupId } = await context.params;
  const { data: spec } = await serviceClient()
    .from("capability_spec")
    .select("intent, median_interactions")
    .eq("group_id", groupId)
    .eq("project_id", project.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!spec) {
    return corsJson({ error: "This opportunity has no compiled capability specification yet.", reason: "no_capability_spec" }, { status: 409 });
  }
  if (!posthogConfigured()) {
    return corsJson({ error: "PostHog is not configured.", reason: "posthog_unavailable" }, { status: 503 });
  }

  try {
    const measured = await measureOutcome({
      projectId: project.id,
      groupId,
      intent: String(spec.intent),
      medianBefore: spec.median_interactions === null ? null : Number(spec.median_interactions),
    });
    if (!measured) {
      return corsJson({ error: "PostHog has no outcome events for this capability yet.", reason: "no_outcome_events" }, { status: 409 });
    }
    return corsJson({ outcome: measured.outcome });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
