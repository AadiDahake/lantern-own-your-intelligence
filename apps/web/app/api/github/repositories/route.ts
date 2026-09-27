/** The repositories this project's GitHub credential can reach, for the connect flow. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { listRepositories } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  try {
    const all = await listRepositories(project.id);
    const repositories = query
      ? all.filter(
          (repository) =>
            repository.fullName.toLowerCase().includes(query) ||
            (repository.description ?? "").toLowerCase().includes(query),
        )
      : all;
    return corsJson({ repositories });
  } catch (error) {
    return corsJson({ error: (error as Error).message }, { status: 502 });
  }
}
