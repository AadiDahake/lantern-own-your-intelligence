/**
 * The developer's decision on a drafted pull request.
 *
 * The route only records the decision. The `escalation` row is the channel for both engines: the
 * `local` worker polls `approval` and moves on, and for a `forge` run the same row is a queue that
 * `npm run forge:runner` claims (see `lib/forge/queue.ts`). Carrying a forge decision out means a
 * merge, a Vercel deployment watch and a sandbox teardown, which together run for longer than any
 * serverless function may live, so no request holds them open.
 */
import { preflight, withCors } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { serviceClient } from "@/lib/supabase";
import { emitTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { approved?: boolean; note?: string };
  if (typeof body.approved !== "boolean") {
    return withCors(Response.json({ error: "approved is required" }, { status: 400 }));
  }
  const note = typeof body.note === "string" ? body.note : "";

  const db = serviceClient();
  const { data: escalation } = await db
    .from("escalation")
    .select("id, project_id, engine, status")
    .eq("id", id)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!escalation) return withCors(Response.json({ error: "not found" }, { status: 404 }));

  const approval = { approved: body.approved, note, decidedAt: new Date().toISOString() };
  await db
    .from("escalation")
    .update({ approval, status: body.approved ? "approved" : "rejected" })
    .eq("id", id);

  await emitTrace({
    projectId: escalation.project_id as string,
    escalationId: id,
    kind: "decision",
    title: body.approved ? "A developer approved the change" : "A developer rejected the change",
    detail: approval,
    source: "agent",
  });

  // 202: the decision is recorded, and the runner carries it out.
  return withCors(
    Response.json({ ok: true, status: body.approved ? "approved" : "rejected" }, { status: 202 }),
  );
}
