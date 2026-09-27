/** Backfill for the Activity page. The live tail is `/api/trace/stream`. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { fetchTrace, readFilters } from "@/lib/console/traceQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    const events = await fetchTrace(readFilters(new URL(request.url), project.id));
    return corsJson({ events });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
