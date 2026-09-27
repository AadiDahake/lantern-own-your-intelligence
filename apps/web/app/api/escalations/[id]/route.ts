/**
 * The widget polls this to show what happened to a reported request.
 *
 * It is the one escalation route the widget reaches, so it is keyed the way every widget route is:
 * by the project's public embed key, which must be the key of the project the escalation belongs
 * to. Without that check an id guessed from another site would read this project's report.
 */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!key) return withCors(Response.json({ error: "key is required" }, { status: 400 }));

  const { id } = await context.params;
  const db = serviceClient();
  const { data } = await db
    .from("escalation")
    .select("id, project_id, status, issue_url, pr_url, deployment_url, request, approval, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return withCors(Response.json({ error: "not found" }, { status: 404 }));

  const { data: project } = await db
    .from("project")
    .select("id")
    .eq("embed_key", key)
    .maybeSingle();
  // Same answer for a wrong key and a wrong id, so neither confirms the other exists.
  if (!project || project.id !== data.project_id) {
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  }

  return withCors(
    Response.json({
      id: data.id,
      status: data.status,
      issueUrl: data.issue_url,
      prUrl: data.pr_url,
      deploymentUrl: data.deployment_url,
      request: data.request,
      approval: data.approval,
      createdAt: data.created_at,
    }),
  );
}
