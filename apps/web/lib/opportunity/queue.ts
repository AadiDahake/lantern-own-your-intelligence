/**
 * The discovery queue: one row per run, enqueued by the request that noticed the gap and
 * executed elsewhere.
 *
 * A request never runs the pipeline before it answers. It inserts a `queued` row and returns.
 * Who runs the row depends on `DISCOVERY_MODE`: `inline` runs it in this process after the
 * response, `runner` leaves it for `npm run discover:runner`. Claiming is atomic either way, so
 * the two can coexist without running the same row twice. At most one run is queued or running
 * per group; a second trigger joins it.
 */
import type { Discovery, DiscoveryTrigger } from "@lantern/shared";
import { discoveryMode, posthogConfigured } from "../env";
import { serviceClient } from "../supabase";
import { emitTrace } from "../trace";
import { DISCOVERY_SELECT, toDiscovery } from "./store";

const UNIQUE_VIOLATION = "23505";

export type DiscoveryRow = Discovery & { projectId: string };

function toRow(row: Record<string, unknown>): DiscoveryRow {
  return { ...toDiscovery(row), projectId: String(row.project_id) };
}

const SELECT = `project_id, ${DISCOVERY_SELECT}`;

/** The run currently queued or running for a group, if any. */
export async function activeDiscovery(groupId: string): Promise<DiscoveryRow | null> {
  const { data } = await serviceClient()
    .from("discovery")
    .select(SELECT)
    .eq("group_id", groupId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** The newest run for a group, whatever its state. */
export async function latestDiscovery(groupId: string): Promise<DiscoveryRow | null> {
  const { data } = await serviceClient()
    .from("discovery")
    .select(SELECT)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** True once any run for the group has finished, whichever way. */
export async function hasFinishedDiscovery(groupId: string): Promise<boolean> {
  const { count } = await serviceClient()
    .from("discovery")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("status", "done");
  return (count ?? 0) > 0;
}

export async function loadDiscovery(id: string): Promise<DiscoveryRow | null> {
  const { data } = await serviceClient().from("discovery").select(SELECT).eq("id", id).maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

/**
 * Inserts a queued run, or joins the one already queued or running for the group. The partial
 * unique index on active runs is what makes the second case a clean conflict rather than a race.
 */
export async function enqueueDiscovery(input: {
  projectId: string;
  groupId: string;
  conversationId?: string | null;
  trigger: DiscoveryTrigger;
}): Promise<{ discovery: DiscoveryRow; created: boolean }> {
  const db = serviceClient();
  const { data, error } = await db
    .from("discovery")
    .insert({
      project_id: input.projectId,
      group_id: input.groupId,
      conversation_id: input.conversationId ?? null,
      trigger: input.trigger,
      status: "queued",
    })
    .select(SELECT)
    .maybeSingle();

  if (data) {
    const discovery = toRow(data as Record<string, unknown>);
    await emitTrace({
      projectId: input.projectId,
      groupId: input.groupId,
      conversationId: input.conversationId ?? null,
      source: "agent",
      kind: "status",
      status: "running",
      title: "Checking whether other customers hit this",
      detail: { discovery_id: discovery.id, trigger: input.trigger },
    });
    return { discovery, created: true };
  }
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);

  const active = await activeDiscovery(input.groupId);
  if (!active) throw new Error(error?.message ?? "the discovery could not be enqueued");
  return { discovery: active, created: false };
}

/** Moves one queued row to running for this process, or returns null when someone else got it. */
export async function claimDiscovery(id: string): Promise<DiscoveryRow | null> {
  const { data } = await serviceClient()
    .from("discovery")
    .update({ status: "running", claimed_by: `inline:${process.pid}`, claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select(SELECT)
    .maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** The oldest queued row, claimed for `worker` atomically through `claim_discovery`. */
export async function claimNextDiscovery(worker: string): Promise<DiscoveryRow | null> {
  const { data, error } = await serviceClient().rpc("claim_discovery", { worker });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * What the request path calls when a turn ends `absent` or a user reports the gap: enqueue once
 * per group, and in inline mode start the run in the background of this process. Never throws
 * and never blocks the caller's response.
 */
export async function triggerDiscovery(input: {
  projectId: string;
  groupId: string;
  conversationId?: string | null;
  trigger: DiscoveryTrigger;
  /** Run again even when an earlier run finished. The console's button; never the agent. */
  force?: boolean;
}): Promise<DiscoveryRow | null> {
  try {
    if (!posthogConfigured()) {
      console.log("discovery skipped: PostHog is not configured");
      return null;
    }
    if (!input.force && (await hasFinishedDiscovery(input.groupId))) return null;
    const { discovery, created } = await enqueueDiscovery(input);
    if (created && discoveryMode() === "inline") {
      // Deferred to the next tick so the caller's response is never held on this.
      const { executeDiscovery } = await import("./run");
      setTimeout(() => {
        void executeDiscovery(discovery.id).catch((error: Error) =>
          console.error("inline discovery failed:", error.message),
        );
      }, 0);
    }
    return discovery;
  } catch (error) {
    console.error("discovery trigger failed:", (error as Error).message);
    return null;
  }
}
