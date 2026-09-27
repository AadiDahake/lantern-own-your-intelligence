/** Everything the agent can answer from: the list, and the way new sources arrive. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { sourceFromRequest } from "@/lib/ingest/request";
import { DOCUMENT_COLUMNS, ingestSource, toConsoleDocument } from "@/lib/ingest/run";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Reading a scanned handbook or crawling a documentation site is minutes of work, not seconds. */
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { data, error } = await serviceClient()
    .from("document")
    .select(DOCUMENT_COLUMNS)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  if (error) return corsJson({ error: error.message }, { status: 500 });
  return corsJson({ documents: (data ?? []).map(toConsoleDocument) });
}

export async function POST(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    const source = await sourceFromRequest(request);
    const document = await ingestSource(project.id, source);
    return corsJson({ document });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "That source could not be added.";
    return corsJson({ error: message }, { status: 400 });
  }
}
