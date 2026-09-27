import type { RequestPriority } from "./types";

/**
 * How near two drafted requests have to be, cosine, to count as the same gap.
 *
 * High on purpose: merging two genuinely different requests is worse than filing two issues,
 * because the second one then never gets its own count and never rises.
 */
export const REQUEST_MATCH_THRESHOLD = 0.86;

/**
 * A group's weight, recomputed from its counts on every join.
 *
 * A person asking outright counts for much more than the agent noticing, but enough quiet
 * detections say the same thing: this keeps coming up, so it matters.
 */
export function priorityFor(reportCount: number, userReportCount: number): RequestPriority {
  if (userReportCount >= 2 || reportCount >= 5) return "high";
  if (userReportCount >= 1 || reportCount >= 3) return "medium";
  return "low";
}

/** Only a request with real weight is worth drafting code for. */
export function warrantsPullRequest(priority: RequestPriority): boolean {
  return priority !== "low";
}
