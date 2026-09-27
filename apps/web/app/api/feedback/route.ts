/** Whether one answer helped, as rated from the widget. */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";
import type { FeedbackRequest } from "@lantern/shared";

export const runtime = "nodejs";

export function OPTIONS(): Response {
  return preflight();
}

const RATINGS: readonly string[] = ["up", "down"];

/** A note is optional and typed by a visitor, so it is trimmed to something storable. */
function note(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 1000);
  return trimmed === "" ? null : trimmed;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Partial<FeedbackRequest>;
  if (!body.key || !body.messageId || !RATINGS.includes(String(body.rating))) {
    return withCors(
      Response.json({ error: "key, messageId and a rating of up or down are required" }, { status: 400 }),
    );
  }

  const db = serviceClient();
  const { data: project } = await db
    .from("project")
    .select("id")
    .eq("embed_key", body.key)
    .maybeSingle();
  if (!project) return withCors(Response.json({ error: "unknown key" }, { status: 403 }));

  // The key names a project, so the message being rated has to belong to that project too.
  const { data: message } = await db
    .from("message")
    .select("id, conversation:conversation_id(project_id)")
    .eq("id", body.messageId)
    .maybeSingle();
  const conversation = message?.conversation as { project_id?: string } | null;
  if (!message || conversation?.project_id !== project.id) {
    return withCors(Response.json({ error: "unknown message" }, { status: 404 }));
  }

  // Changing your mind replaces the rating rather than filing a second one.
  const { error } = await db.from("message_feedback").upsert(
    {
      message_id: message.id,
      project_id: project.id,
      rating: body.rating,
      note: note(body.note),
    },
    { onConflict: "message_id" },
  );
  if (error) return withCors(Response.json({ error: error.message }, { status: 500 }));

  return withCors(Response.json({ ok: true }));
}
