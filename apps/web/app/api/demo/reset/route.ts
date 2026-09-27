/**
 * Puts the demo back to its starting position.
 *
 * This closes real issues and pull requests and deletes real rows, all of them the caller's own.
 * The knowledge base is never touched.
 */
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { activeGithubToken } from "@/lib/github/connection";
import { resetDemo } from "@/lib/demo/reset";
import { corsJson, preflight } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    const summary = await resetDemo({
      repo: project.repoFullName,
      githubToken: await activeGithubToken(project.id),
      supabaseUrl: process.env.SUPABASE_URL ?? null,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
      projectId: project.id,
    });
    return corsJson({ summary });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 500 });
  }
}
