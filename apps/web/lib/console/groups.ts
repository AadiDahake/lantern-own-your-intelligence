/**
 * Reads for the Requests list: one row per gap in the product, not one per conversation.
 *
 * Ordering is the whole point of the page. What matters most is what most people have run into,
 * so groups come back by priority and then by how recently they were last reported.
 */
import type { RequestGroup, RequestPriority, RequestGroupStatus } from "@lantern/shared";
import { serviceClient } from "@/lib/supabase";

const GROUP_COLUMNS =
  "id, title, description, area, report_count, user_report_count, priority, status, issue_url, issue_number, pr_url, escalation_id, first_seen, last_seen";

const PRIORITY_RANK: Record<RequestPriority, number> = { high: 0, medium: 1, low: 2 };

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function toRequestGroup(row: Record<string, unknown>): RequestGroup {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    area: String(row.area ?? ""),
    reportCount: Number(row.report_count ?? 0),
    userReportCount: Number(row.user_report_count ?? 0),
    priority: String(row.priority ?? "low") as RequestPriority,
    status: String(row.status ?? "observed") as RequestGroupStatus,
    issueUrl: nullable(row.issue_url),
    issueNumber:
      row.issue_number === null || row.issue_number === undefined ? null : Number(row.issue_number),
    prUrl: nullable(row.pr_url),
    escalationId: nullable(row.escalation_id),
    firstSeen: String(row.first_seen ?? ""),
    lastSeen: String(row.last_seen ?? ""),
  };
}

/** Every request the project has accumulated, heaviest first. */
export async function loadRequestGroups(projectId: string): Promise<RequestGroup[]> {
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .select(GROUP_COLUMNS)
    .eq("project_id", projectId)
    .order("last_seen", { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => toRequestGroup(row as Record<string, unknown>))
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
        b.lastSeen.localeCompare(a.lastSeen),
    );
}

/** The group each of these conversations was filed under, when there is one. */
export async function groupsByConversation(ids: string[]): Promise<Map<string, RequestGroup>> {
  const found = new Map<string, RequestGroup>();
  if (ids.length === 0) return found;

  const db = serviceClient();
  const { data: runs } = await db
    .from("escalation")
    .select("conversation_id, group_id")
    .in("conversation_id", ids)
    .not("group_id", "is", null);

  const byConversation = new Map<string, string>();
  for (const run of runs ?? []) {
    byConversation.set(String(run.conversation_id), String(run.group_id));
  }
  if (byConversation.size === 0) return found;

  const { data: groups } = await db
    .from("feature_request_group")
    .select(GROUP_COLUMNS)
    .in("id", [...new Set(byConversation.values())]);

  const groupsById = new Map<string, RequestGroup>();
  for (const row of groups ?? []) {
    const group = toRequestGroup(row as Record<string, unknown>);
    groupsById.set(group.id, group);
  }
  for (const [conversationId, groupId] of byConversation) {
    const group = groupsById.get(groupId);
    if (group) found.set(conversationId, group);
  }
  return found;
}
