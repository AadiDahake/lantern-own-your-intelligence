/** "Mar 4, 2:05 PM" - the compact absolute time every console list uses. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "14:02:31" - trace rows are read in sequence, so they only need the clock. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const STATUS_TONE: Record<string, string> = {
  queued: "is-wait",
  filing: "is-run",
  inspecting: "is-run",
  drafting: "is-run",
  pr_open: "is-run",
  awaiting_approval: "is-wait",
  approved: "is-good",
  rejected: "is-bad",
  merging: "is-run",
  deploying: "is-run",
  shipped: "is-good",
  failed: "is-bad",
};

export function escalationTone(status: string): string {
  return STATUS_TONE[status] ?? "is-muted";
}

/** `awaiting_approval` reads badly in a badge; the label is what a person would say. */
const STATUS_LABEL: Record<string, string> = {
  pr_open: "draft pr open",
  awaiting_approval: "awaiting approval",
};

export function escalationLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

/** A request group's state, in the words a person would use. */
const REQUEST_STATUS_LABEL: Record<string, string> = {
  observed: "noticed",
  filed: "filed",
  drafting: "drafting a change",
  pr_open: "draft pr open",
  awaiting_approval: "awaiting approval",
  shipped: "shipped",
  rejected: "not being built",
};

export function requestStatusLabel(status: string): string {
  return REQUEST_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

const REQUEST_STATUS_TONE: Record<string, string> = {
  observed: "is-muted",
  filed: "is-wait",
  drafting: "is-run",
  pr_open: "is-run",
  awaiting_approval: "is-wait",
  shipped: "is-good",
  rejected: "is-bad",
};

export function requestStatusTone(status: string): string {
  return REQUEST_STATUS_TONE[status] ?? "is-muted";
}

/** "Reported 3 times (1 by users)" - the weight behind a request, in one line. */
export function reportCountLabel(reportCount: number, userReportCount: number): string {
  const times = reportCount === 1 ? "once" : `${reportCount} times`;
  const users = userReportCount === 1 ? "1 by a user" : `${userReportCount} by users`;
  return `Reported ${times} (${users})`;
}

/** "4m 12s" - how long a conversation ran, or "-" when there is only one message. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

/** "just now", "3m ago", "2h ago", "5d ago" - how recent a source is, at a glance. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "1.2 MB" - a file size a person can read. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An opportunity's stage in the story, as a word or two. Status is text, never a colour alone. */
const OPPORTUNITY_STATUS_LABEL: Record<string, string> = {
  discovering: "discovering",
  not_warranted: "no capability warranted",
  failed: "discovery failed",
  discovered: "discovered",
  building: "building",
  verified: "verified",
  pr_open: "pr open",
  merged: "merged",
  measured: "measured",
};

export function opportunityStatusLabel(status: string): string {
  return OPPORTUNITY_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

const OPPORTUNITY_STATUS_TONE: Record<string, string> = {
  discovering: "is-run",
  not_warranted: "is-muted",
  failed: "is-bad",
  discovered: "is-wait",
  building: "is-run",
  verified: "is-good",
  pr_open: "is-run",
  merged: "is-good",
  measured: "is-good",
};

export function opportunityStatusTone(status: string): string {
  return OPPORTUNITY_STATUS_TONE[status] ?? "is-muted";
}

/** A candidate sandbox's state, in the words a person would use. */
const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  provisioning: "provisioning",
  building: "building",
  testing: "testing",
  ready: "ready",
  failed: "failed",
  torn_down: "torn down",
};

export function candidateStatusLabel(status: string): string {
  return CANDIDATE_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

const CANDIDATE_STATUS_TONE: Record<string, string> = {
  queued: "is-wait",
  provisioning: "is-run",
  building: "is-run",
  testing: "is-run",
  ready: "is-good",
  failed: "is-bad",
  torn_down: "is-muted",
};

export function candidateStatusTone(status: string): string {
  return CANDIDATE_STATUS_TONE[status] ?? "is-muted";
}

/** "14" or "14.5": a median shown as a person would write it, or "-" when there is none. */
export function formatMedian(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "1,428". */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US");
}
