/** Every reported feature request, newest first. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadEscalations } from "@/lib/console/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  try {
    return corsJson({ escalations: await loadEscalations(project.id) });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
