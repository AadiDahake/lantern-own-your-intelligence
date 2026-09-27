import type { TraceEvent } from "@lantern/shared";
import { toTraceEvent } from "@/lib/trace";
import { serviceClient } from "@/lib/supabase";

export type TraceFilters = {
  projectId: string;
  conversationId: string | null;
  escalationId: string | null;
  /** One opportunity: the chat rows and the pipeline rows that carry its group id. */
  groupId: string | null;
  /** One trace kind, when a caller only wants those rows (the heartbeat asks for `status`). */
  kind: string | null;
  since: number;
  limit: number;
  /** Newest first. The live tail reads forward; a caller after the latest row reads back. */
  newestFirst: boolean;
};

/** Parses the filters both `/api/trace` and `/api/trace/stream` accept. */
export function readFilters(url: URL, projectId: string): TraceFilters {
  const since = Number(url.searchParams.get("since") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "300");
  return {
    projectId,
    conversationId: url.searchParams.get("conversationId") || null,
    escalationId: url.searchParams.get("escalationId") || null,
    groupId: url.searchParams.get("groupId") || null,
    kind: url.searchParams.get("kind") || null,
    since: Number.isFinite(since) && since > 0 ? since : 0,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 300,
    newestFirst: url.searchParams.get("order") === "desc",
  };
}

/**
 * Rows for one selection, oldest first.
 *
 * When more than one of a conversation, an escalation and a group are given they are ORed,
 * because one escalation's story starts in the chat that produced it, and an opportunity's story
 * spans the chat that noticed it, the pipeline that compiled it and the run that built it. The
 * console shows each as a single trace.
 */
export async function fetchTrace(filters: TraceFilters): Promise<TraceEvent[]> {
  let query = serviceClient()
    .from("trace_event")
    .select("id, project_id, conversation_id, escalation_id, group_id, source, kind, status, title, detail, created_at")
    .eq("project_id", filters.projectId)
    .gt("id", filters.since)
    .order("id", { ascending: !filters.newestFirst })
    .limit(filters.limit);

  if (filters.kind) query = query.eq("kind", filters.kind);

  const clauses = [
    filters.conversationId ? `conversation_id.eq.${filters.conversationId}` : null,
    filters.escalationId ? `escalation_id.eq.${filters.escalationId}` : null,
    filters.groupId ? `group_id.eq.${filters.groupId}` : null,
  ].filter((clause): clause is string => clause !== null);
  if (clauses.length === 1) {
    const [column, value] = (clauses[0] as string).split(".eq.");
    query = query.eq(column as string, value as string);
  } else if (clauses.length > 1) {
    query = query.or(clauses.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toTraceEvent(row as Record<string, unknown>));
}
