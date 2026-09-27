/**
 * Runs the opportunity pipeline for a group on demand.
 *
 * The route enqueues and answers `202` at once. Who runs the row depends on `DISCOVERY_MODE`:
 * this process after the response, or `npm run discover:runner`. The console polls the group's
 * opportunity for the result. A run already queued or running for the group is joined, not
 * duplicated.
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { posthogConfigured } from "@/lib/env";
import { enqueueDiscovery } from "@/lib/opportunity/queue";
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
  const { data: group } = await serviceClient()
    .from("feature_request_group")
    .select("id")
    .eq("id", groupId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!group) return corsJson({ error: "not found" }, { status: 404 });

  if (!posthogConfigured()) {
    return corsJson(
      { error: "PostHog is not configured: set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID.", reason: "posthog_unavailable" },
      { status: 503 },
    );
  }

  try {
    const { discovery, created } = await enqueueDiscovery({ projectId: project.id, groupId, trigger: "manual" });
    if (created) {
      const { discoveryMode } = await import("@/lib/env");
      if (discoveryMode() === "inline") {
        const { executeDiscovery } = await import("@/lib/opportunity/run");
        setTimeout(() => {
          void executeDiscovery(discovery.id).catch((error: Error) => console.error("inline discovery failed:", error.message));
        }, 0);
      }
    }
    return corsJson({ discoveryId: discovery.id, status: discovery.status, created }, { status: 202 });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
