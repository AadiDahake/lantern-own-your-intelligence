import type { TraceEvent } from "@lantern/shared";
import { serviceClient } from "./supabase";

export type TraceInput = {
  projectId: string;
  conversationId?: string | null;
  escalationId?: string | null;
  /** The opportunity this row belongs to, when the writer knows it. */
  groupId?: string | null;
  source: TraceEvent["source"];
  kind: TraceEvent["kind"];
  status?: TraceEvent["status"];
  title: string;
  detail?: unknown;
};

/**
 * Appends one row to the trace log, which is what the console's Activity page streams.
 *
 * Tracing is observability, not behaviour: a failed insert is logged and swallowed so it can never
 * fail the user's request.
 */
export async function emitTrace(input: TraceInput): Promise<void> {
  const { error } = await serviceClient().from("trace_event").insert({
    project_id: input.projectId,
    conversation_id: input.conversationId ?? null,
    escalation_id: input.escalationId ?? null,
    group_id: input.groupId ?? null,
    source: input.source,
    kind: input.kind,
    status: input.status ?? "ok",
    title: input.title,
    detail: input.detail ?? null,
  });

  if (error) console.error("trace insert failed:", error.message);
}

/** Maps a database row onto the wire shape the console consumes. */
export function toTraceEvent(row: Record<string, unknown>): TraceEvent {
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    conversationId: row.conversation_id === null ? null : String(row.conversation_id),
    escalationId: row.escalation_id === null ? null : String(row.escalation_id),
    groupId: row.group_id === null || row.group_id === undefined ? null : String(row.group_id),
    source: row.source as TraceEvent["source"],
    kind: row.kind as TraceEvent["kind"],
    status: row.status as TraceEvent["status"],
    title: String(row.title),
    detail: row.detail ?? null,
    createdAt: String(row.created_at),
  };
}
