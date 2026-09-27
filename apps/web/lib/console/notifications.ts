/**
 * What the worker has opened on GitHub, for the bell in the console bar.
 *
 * The unit is the request, not the conversation. Ten people asking for the same thing is one
 * issue and one pull request, so it is one line in the bell with the weight behind it, rather
 * than ten identical lines that bury everything else.
 */
import { serviceClient } from "@/lib/supabase";

export type NotificationKind = "issue" | "pull_request";

export type Notification = {
  /** Stable across reloads, so "seen" can be remembered without a server round trip. */
  id: string;
  groupId: string;
  kind: NotificationKind;
  number: number | null;
  url: string;
  title: string;
  status: string;
  /** How many conversations are behind this, and how many of them asked outright. */
  reportCount: number;
  userReportCount: number;
  at: string;
};

export const NOTIFICATION_LIMIT = 10;

type GroupRow = {
  id: unknown;
  title: unknown;
  status: unknown;
  report_count: unknown;
  user_report_count: unknown;
  issue_url: unknown;
  issue_number: unknown;
  pr_url: unknown;
  first_seen: unknown;
  last_seen: unknown;
};

function groupTitle(title: unknown): string {
  return typeof title === "string" && title.trim() !== "" ? title.trim() : "Feature request";
}

/** The number GitHub gave the pull request, read back off its own URL. */
function pullNumber(url: string): number | null {
  const match = /\/pull\/(\d+)/.exec(url);
  return match ? Number(match[1]) : null;
}

/** The pull request is always the later of the two, so it reads first inside one request. */
const KIND_ORDER: Record<NotificationKind, number> = { pull_request: 0, issue: 1 };

/** Flattens request groups into the newest things the worker opened for them. */
export function toNotifications(rows: GroupRow[]): Notification[] {
  const found: Notification[] = [];

  for (const row of rows) {
    const groupId = String(row.id);
    const at = String(row.last_seen ?? row.first_seen ?? "");
    const common = {
      groupId,
      title: groupTitle(row.title),
      status: String(row.status ?? ""),
      reportCount: Number(row.report_count ?? 0),
      userReportCount: Number(row.user_report_count ?? 0),
      at,
    };

    if (typeof row.issue_url === "string" && row.issue_url !== "") {
      found.push({
        ...common,
        id: `${groupId}:issue`,
        kind: "issue",
        number:
          row.issue_number === null || row.issue_number === undefined
            ? null
            : Number(row.issue_number),
        url: row.issue_url,
      });
    }
    if (typeof row.pr_url === "string" && row.pr_url !== "") {
      found.push({
        ...common,
        id: `${groupId}:pull_request`,
        kind: "pull_request",
        number: pullNumber(row.pr_url),
        url: row.pr_url,
      });
    }
  }

  return found
    .sort((a, b) => (a.at === b.at ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : b.at.localeCompare(a.at)))
    .slice(0, NOTIFICATION_LIMIT);
}

export async function loadNotifications(projectId: string): Promise<Notification[]> {
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .select(
      "id, title, status, report_count, user_report_count, issue_url, issue_number, pr_url, first_seen, last_seen",
    )
    .eq("project_id", projectId)
    .or("issue_url.not.is.null,pr_url.not.is.null")
    .order("last_seen", { ascending: false })
    .limit(NOTIFICATION_LIMIT);
  if (error) throw new Error(error.message);

  return toNotifications((data ?? []) as GroupRow[]);
}
