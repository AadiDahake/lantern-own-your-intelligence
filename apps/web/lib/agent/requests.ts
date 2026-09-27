/**
 * Request grouping: the same gap, however many people run into it, is one request.
 *
 * Every drafted feature request is embedded and matched against the groups this project already
 * has. A near match joins that group and raises its counts; anything else starts a new one. The
 * counts are what decide how much work the group is worth, which is the whole point: a gap the
 * agent noticed once is a note to the developers, and a gap that keeps coming back is a task.
 */
import { REQUEST_MATCH_THRESHOLD, priorityFor, warrantsPullRequest } from "@lantern/shared";
import type { FeatureRequest, RequestGroup, RequestGroupStatus, RequestPriority } from "@lantern/shared";
import { embed } from "../openai";
import { serviceClient } from "../supabase";
import { startRun, type RunProject } from "./runner";

/** Where a report came from. A person asking outright weighs far more than the agent noticing. */
export type ReportSource = "auto" | "user";

/** What the worker should do about a group now that this report has joined it. */
export type GroupAction = "file_only" | "full" | "update" | "none";

export type GroupJoin = {
  group: RequestGroup;
  /** True when this report started the group rather than joining one. */
  created: boolean;
  action: GroupAction;
};

const GROUP_COLUMNS =
  "id, title, description, area, report_count, user_report_count, priority, status, issue_url, issue_number, pr_url, escalation_id, first_seen, last_seen";

function toGroup(row: Record<string, unknown>): RequestGroup {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    area: String(row.area ?? ""),
    reportCount: Number(row.report_count ?? 0),
    userReportCount: Number(row.user_report_count ?? 0),
    priority: String(row.priority ?? "low") as RequestPriority,
    status: String(row.status ?? "observed") as RequestGroupStatus,
    issueUrl: row.issue_url === null || row.issue_url === undefined ? null : String(row.issue_url),
    issueNumber:
      row.issue_number === null || row.issue_number === undefined ? null : Number(row.issue_number),
    prUrl: row.pr_url === null || row.pr_url === undefined ? null : String(row.pr_url),
    escalationId:
      row.escalation_id === null || row.escalation_id === undefined
        ? null
        : String(row.escalation_id),
    firstSeen: String(row.first_seen ?? ""),
    lastSeen: String(row.last_seen ?? ""),
  };
}

/** What the group is about, in the words the matcher compares. */
function groupText(request: Pick<FeatureRequest, "title" | "description">): string {
  return `${request.title} ${request.description}`.trim();
}

/**
 * The run the worker should make for this group, if any.
 *
 * A brand new group files its issue and stops there: the developers hear about it, at the bottom
 * of the pile, without anyone drafting code nobody asked for. Weight changes that. Once a group
 * is worth a pull request it gets one, exactly once; every later report only carries its new
 * count and quote to the issue and the pull request that already exist.
 */
export function actionFor(group: RequestGroup, created: boolean, hasRepository: boolean): GroupAction {
  if (!hasRepository) return "none";
  if (created) return "file_only";
  if (!DRAFTED.has(group.status) && group.prUrl === null && warrantsPullRequest(group.priority)) {
    return "full";
  }
  return "update";
}

/** Group states a full run has already reached, so a second one must never start. */
const DRAFTED = new Set<RequestGroupStatus>([
  "drafting",
  "pr_open",
  "awaiting_approval",
  "shipped",
  "rejected",
]);

/** The group nearest this request, when it is near enough to be the same gap. */
async function nearestGroup(projectId: string, embedding: number[]): Promise<RequestGroup | null> {
  const { data, error } = await serviceClient().rpc("match_request_groups", {
    query_embedding: embedding,
    match_count: 3,
    filter_project: projectId,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const best = rows[0];
  if (!best || Number(best.similarity ?? 0) < REQUEST_MATCH_THRESHOLD) return null;
  return toGroup(best);
}

async function createGroup(
  projectId: string,
  request: FeatureRequest,
  embedding: number[],
  source: ReportSource,
): Promise<RequestGroup> {
  const userReports = source === "user" ? 1 : 0;
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .insert({
      project_id: projectId,
      title: request.title,
      description: request.description,
      area: request.area,
      embedding,
      report_count: 1,
      user_report_count: userReports,
      priority: priorityFor(1, userReports),
      status: "observed",
    })
    .select(GROUP_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "the request group could not be created");
  return toGroup(data as Record<string, unknown>);
}

/**
 * Adds one report to a group and recomputes its weight.
 *
 * A user report never raises `report_count`: the conversation it came from was already counted
 * the moment the agent drafted the request, and counting it twice would inflate the group.
 */
async function joinGroup(group: RequestGroup, source: ReportSource): Promise<RequestGroup> {
  const reportCount = source === "user" ? group.reportCount : group.reportCount + 1;
  const userReportCount = source === "user" ? group.userReportCount + 1 : group.userReportCount;
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .update({
      report_count: reportCount,
      user_report_count: userReportCount,
      priority: priorityFor(reportCount, userReportCount),
      last_seen: new Date().toISOString(),
    })
    .eq("id", group.id)
    .select(GROUP_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "the request group could not be updated");
  return toGroup(data as Record<string, unknown>);
}

/**
 * Files this request against the project's groups: joins the nearest one, or starts a new one.
 *
 * `hasRepository` only decides whether there is anywhere to file: a project with no repository
 * still accumulates the demand, so the counts are already right on the day one is connected.
 */
export async function recordRequest(input: {
  projectId: string;
  request: FeatureRequest;
  source: ReportSource;
  hasRepository: boolean;
  /** Reuse an already-known group instead of matching, when the caller knows which one. */
  groupId?: string | null;
}): Promise<GroupJoin> {
  const db = serviceClient();

  let existing: RequestGroup | null = null;
  let embedding: number[] | null = null;

  if (input.groupId) {
    const { data } = await db
      .from("feature_request_group")
      .select(GROUP_COLUMNS)
      .eq("id", input.groupId)
      .maybeSingle();
    if (data) existing = toGroup(data as Record<string, unknown>);
  }
  if (!existing) {
    const vectors = await embed([groupText(input.request)]);
    embedding = vectors[0] ?? null;
    if (embedding) existing = await nearestGroup(input.projectId, embedding);
  }

  if (existing) {
    const group = await joinGroup(existing, input.source);
    return { group, created: false, action: actionFor(group, false, input.hasRepository) };
  }
  if (!embedding) throw new Error("the request could not be embedded");

  const group = await createGroup(input.projectId, input.request, embedding, input.source);
  return { group, created: true, action: actionFor(group, true, input.hasRepository) };
}

/** The group a message's request was filed under, when there is one. */
export async function groupForMessage(messageId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from("escalation")
    .select("group_id")
    .eq("message_id", messageId)
    .not("group_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const groupId = (data as { group_id?: unknown } | null)?.group_id;
  return typeof groupId === "string" ? groupId : null;
}

/**
 * Records a gap the agent found on its own, so the console can see how often it comes back.
 *
 * This is the quiet half of reporting, and it stays quiet: the group's counts rise and the
 * opportunity dashboard gains a row, and nothing is filed anywhere. Filing an issue is an outward
 * action in the customer's own repository, and the only thing that authorises it is a person
 * accepting the offer - which is `reportRequest`, one issue per group. A visitor who says the
 * feature is not needed must not end up having opened one.
 *
 * Never throws: the user's answer must not depend on it.
 */
export async function noteRequest(input: {
  projectId: string;
  request: FeatureRequest;
}): Promise<{ noted: boolean; groupId: string | null }> {
  try {
    // Nowhere to file, by design: the `action` this returns is for the reporting path alone.
    const join = await recordRequest({
      projectId: input.projectId,
      request: input.request,
      source: "auto",
      hasRepository: false,
    });
    return { noted: true, groupId: join.group.id };
  } catch (error) {
    console.error("automatic request note failed:", (error as Error).message);
    return { noted: false, groupId: null };
  }
}

/**
 * Records that the user asked for this themselves, on top of the note the agent already made.
 *
 * Returns the run the widget should follow: the one that owns the group when there is one, so a
 * second reporter watches the same issue and pull request rather than a run of their own.
 */
export async function reportRequest(input: {
  project: RunProject;
  request: FeatureRequest;
  conversationId?: string | null;
  messageId: string;
}): Promise<{ group: RequestGroup; action: GroupAction; escalationId: string }> {
  const join = await recordRequest({
    projectId: input.project.id,
    request: input.request,
    source: "user",
    hasRepository: true,
    groupId: await groupForMessage(input.messageId),
  });
  const escalationId = await startRun({
    project: input.project,
    group: join.group,
    request: input.request,
    mode: join.action === "none" ? "update" : join.action,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId,
  });
  return {
    group: join.group,
    action: join.action,
    escalationId: join.action === "update" ? (join.group.escalationId ?? escalationId) : escalationId,
  };
}
