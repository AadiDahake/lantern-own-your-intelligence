/** Accepts the user's offer to report a missing feature and starts the run that builds it. */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";
import { emitTrace } from "@/lib/trace";
import { reportRequest } from "@/lib/agent/requests";
import { assertEngineAvailable } from "@/lib/agent/runner";
import { triggerDiscovery } from "@/lib/opportunity/queue";
import type { EscalateRequest, FeatureRequest } from "@lantern/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  // Nothing is written until the engine that would carry the run can actually run. A `forge`
  // engine without its keys is refused here rather than accepted and dropped into a queue nobody
  // reads.
  try {
    assertEngineAvailable();
  } catch (error) {
    return withCors(
      Response.json({ error: (error as Error).message, reason: "engine_unavailable" }, { status: 503 }),
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<EscalateRequest>;
  if (!body.key || !body.messageId) {
    return withCors(Response.json({ error: "key and messageId are required" }, { status: 400 }));
  }

  const db = serviceClient();
  const { data: project } = await db
    .from("project")
    .select("id, repo_full_name, repo_default_branch, site_url")
    .eq("embed_key", body.key)
    .maybeSingle();
  if (!project) return withCors(Response.json({ error: "unknown key" }, { status: 403 }));
  // Nothing downstream works without a repository: no issue to file, no branch to push.
  if (!project.repo_full_name) {
    return withCors(
      Response.json(
        { error: "no repository is connected to this project", reason: "no_repository" },
        { status: 409 },
      ),
    );
  }

  // The key names a project, so the message it points at has to belong to that project too.
  const { data: message } = await db
    .from("message")
    .select("id, content, feature_request, conversation:conversation_id(project_id)")
    .eq("id", body.messageId)
    .maybeSingle();
  const conversation = message?.conversation as { project_id?: string } | null;
  const featureRequest =
    conversation?.project_id === project.id
      ? (message?.feature_request as FeatureRequest | null)
      : null;
  if (!featureRequest) {
    return withCors(Response.json({ error: "that message has no feature request" }, { status: 400 }));
  }

  // The report can come from a conversation that started before the widget had an id.
  if (body.conversationId && typeof body.visitorId === "string" && body.visitorId) {
    await db
      .from("conversation")
      .update({ visitor_id: body.visitorId.slice(0, 64) })
      .eq("id", body.conversationId)
      .is("visitor_id", null);
  }

  // The agent already noted this gap when it drafted the request. Asking outright is what raises
  // it: the group counts one more user behind it, and decides what that is now worth.
  const reported = await reportRequest({
    project: {
      id: String(project.id),
      repoFullName: String(project.repo_full_name),
      defaultBranch: String(project.repo_default_branch ?? "main"),
      siteUrl: project.site_url === null ? null : String(project.site_url),
    },
    request: featureRequest,
    conversationId: body.conversationId ?? null,
    messageId: body.messageId,
  });

  // The report is also the second question's trigger: does PostHog know other people who
  // worked around this? Enqueued once per group; a run already made is left alone.
  void triggerDiscovery({
    projectId: String(project.id),
    groupId: reported.group.id,
    conversationId: body.conversationId ?? null,
    trigger: "user",
  });

  await emitTrace({
    projectId: String(project.id),
    groupId: reported.group.id,
    escalationId: reported.escalationId,
    conversationId: body.conversationId ?? null,
    kind: "decision",
    title: "The user asked for this to be reported",
    detail: {
      ...featureRequest,
      groupId: reported.group.id,
      reportCount: reported.group.reportCount,
      userReportCount: reported.group.userReportCount,
      priority: reported.group.priority,
    },
    source: "agent",
  });

  return withCors(
    Response.json({
      escalationId: reported.escalationId,
      groupId: reported.group.id,
      status: "queued",
    }),
  );
}
