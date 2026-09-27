/** One opportunity with everything behind it. The detail page polls this while a run is going. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadOpportunity } from "@/lib/opportunity/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  const { groupId } = await context.params;
  try {
    const opportunity = await loadOpportunity(project.id, groupId);
    if (!opportunity) return corsJson({ error: "not found" }, { status: 404 });
    return corsJson({ opportunity });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
