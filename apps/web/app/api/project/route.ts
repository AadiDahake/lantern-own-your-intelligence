/** The caller's project, and the one form that edits it. */
import { corsJson, preflight } from "@/lib/cors";
import { getRepository } from "@/lib/github";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { PROJECT_COLUMNS, embedSnippet, toProject, widgetUrl } from "@/lib/console/project";
import { loadCounts, loadWorkerStatus } from "@/lib/console/counts";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const [counts, worker] = await Promise.all([
    loadCounts(project.id),
    loadWorkerStatus(project.id),
  ]);
  return corsJson({
    project,
    counts,
    worker,
    embedSnippet: embedSnippet(project.embedKey),
    widgetUrl: widgetUrl(),
  });
}

type Patch = {
  repoFullName?: unknown;
  siteUrl?: unknown;
  settings?: unknown;
};

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export async function PATCH(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const body = (await request.json().catch(() => ({}))) as Patch;
  const update: Record<string, unknown> = {};

  // `null` unbinds the repository; a string binds one, once the token proves it can read it.
  if (body.repoFullName === null) {
    update.repo_full_name = null;
    update.repo_default_branch = null;
  } else if (body.repoFullName !== undefined) {
    if (typeof body.repoFullName !== "string" || !REPO_PATTERN.test(body.repoFullName.trim())) {
      return corsJson({ error: "repoFullName must look like owner/name" }, { status: 400 });
    }
    const fullName = body.repoFullName.trim();
    // The bind is only worth writing if the token can actually reach the repository.
    let repository;
    try {
      repository = await getRepository(project.id, fullName);
    } catch (error) {
      return corsJson({ error: (error as Error).message }, { status: 502 });
    }
    if (!repository) {
      return corsJson(
        { error: `Lantern cannot reach ${fullName}. Check the name and the token's access.` },
        { status: 404 },
      );
    }
    update.repo_full_name = repository.fullName;
    update.repo_default_branch = repository.defaultBranch;
  }

  if (body.siteUrl !== undefined) {
    if (typeof body.siteUrl !== "string") {
      return corsJson({ error: "siteUrl must be a string" }, { status: 400 });
    }
    update.site_url = body.siteUrl.trim() || null;
  }

  if (body.settings !== undefined) {
    if (typeof body.settings !== "object" || body.settings === null || Array.isArray(body.settings)) {
      return corsJson({ error: "settings must be an object" }, { status: 400 });
    }
    update.settings = { ...project.settings, ...(body.settings as Record<string, unknown>) };
  }

  if (Object.keys(update).length === 0) {
    return corsJson({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await serviceClient()
    .from("project")
    .update(update)
    .eq("id", project.id)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    return corsJson({ error: error?.message ?? "the update did not apply" }, { status: 500 });
  }

  const saved = toProject(data as Record<string, unknown>);
  return corsJson({ project: saved, embedSnippet: embedSnippet(saved.embedKey), widgetUrl: widgetUrl() });
}
