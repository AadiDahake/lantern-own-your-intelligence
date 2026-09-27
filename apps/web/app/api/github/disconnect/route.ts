/** Unlinks the GitHub account. The repository binding stays, so the agent keeps reading it. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { clearConnection } from "@/lib/github/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    await clearConnection(project.id);
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
  return corsJson({ ok: true });
}
