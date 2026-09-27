/** Recent conversations with their outcome, for the Conversations and Activity pages. */
import { corsJson, preflight } from "@/lib/cors";
import { isConversationOutcome } from "@/lib/agent/outcome";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadConversationSummaries, loadOutcomeCounts } from "@/lib/console/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("limit") ?? "60");
  const limit = Number.isFinite(requested) ? requested : 60;
  const filter = params.get("outcome");
  if (filter && filter !== "all" && !isConversationOutcome(filter)) {
    return corsJson({ error: `Unknown outcome "${filter}"` }, { status: 400 });
  }
  const outcome = filter && isConversationOutcome(filter) ? filter : undefined;

  try {
    const [conversations, counts] = await Promise.all([
      loadConversationSummaries(project.id, { outcome, limit }),
      loadOutcomeCounts(project.id),
    ]);
    return corsJson({ conversations, counts });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
