/** One conversation: every message in order with the evidence behind it. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadConversationDetail } from "@/lib/console/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;
  try {
    const conversation = await loadConversationDetail(project.id, id);
    if (!conversation) return corsJson({ error: "No such conversation." }, { status: 404 });
    return corsJson({ conversation });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
