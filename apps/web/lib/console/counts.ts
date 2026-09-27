import { serviceClient } from "@/lib/supabase";

export type ConsoleCounts = {
  documents: number;
  chunks: number;
  conversations: number;
  escalations: number;
};

async function countRows(table: string, projectId: string): Promise<number> {
  const { count } = await serviceClient()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  return count ?? 0;
}

/** The four numbers the overview page shows. */
export async function loadCounts(projectId: string): Promise<ConsoleCounts> {
  const [documents, chunks, conversations, escalations] = await Promise.all([
    countRows("document", projectId),
    countRows("chunk", projectId),
    countRows("conversation", projectId),
    countRows("escalation", projectId),
  ]);
  return { documents, chunks, conversations, escalations };
}

export type WorkerStatus = { lastSeenAt: string | null; online: boolean };

/**
 * The worker writes a `status` trace event every minute. Anything inside two minutes counts as
 * online; anything older, or nothing at all, counts as offline.
 */
export async function loadWorkerStatus(projectId: string): Promise<WorkerStatus> {
  const { data } = await serviceClient()
    .from("trace_event")
    .select("created_at")
    .eq("project_id", projectId)
    .eq("source", "workflow")
    .eq("kind", "status")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastSeenAt = data ? String(data.created_at) : null;
  const seen = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
  return { lastSeenAt, online: Number.isFinite(seen) && Date.now() - seen < 120_000 };
}

/** Escalations grouped by the status they are sitting in, newest schema values included. */
export async function loadEscalationStatusCounts(
  projectId: string,
): Promise<{ status: string; count: number }[]> {
  const { data } = await serviceClient()
    .from("escalation")
    .select("status")
    .eq("project_id", projectId);

  const tally = new Map<string, number>();
  for (const row of data ?? []) {
    const status = String(row.status);
    tally.set(status, (tally.get(status) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}
