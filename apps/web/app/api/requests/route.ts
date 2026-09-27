/** Every gap the agent has collected for this project, heaviest first. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadRequestGroups } from "@/lib/console/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  try {
    return corsJson({ requests: await loadRequestGroups(project.id) });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
