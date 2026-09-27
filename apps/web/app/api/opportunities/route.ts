/** Every opportunity of the project: request groups with evidence behind them, newest first. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { loadOpportunities } from "@/lib/opportunity/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  try {
    return corsJson({ opportunities: await loadOpportunities(project.id) });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
