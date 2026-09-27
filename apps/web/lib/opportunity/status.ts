/**
 * Where an opportunity has got to, derived from its rows in the order the story runs: the
 * discovery, the specification, the forge run, the pull request, the outcome. Nothing stores
 * this; it is read off the rows every time, so it can never be stale.
 */
import type { Discovery, OpportunityStatus } from "@lantern/shared";

export type StatusInput = {
  discovery: Pick<Discovery, "status" | "decision"> | null;
  hasSpec: boolean;
  escalation: { status: string; prUrl: string | null; winningCandidateId: string | null } | null;
  candidates: { status: string; scenariosPassed: number | null }[];
  hasOutcome: boolean;
};

const PR_STATES = new Set(["pr_open", "awaiting_approval", "approved", "merging", "deploying"]);
const BUILD_STATES = new Set(["queued", "filing", "filed", "inspecting", "drafting"]);

export function opportunityStatus(input: StatusInput): OpportunityStatus {
  if (input.hasOutcome) return "measured";
  const run = input.escalation;
  if (run) {
    if (run.status === "shipped") return "merged";
    if (PR_STATES.has(run.status) || run.prUrl) return "pr_open";
    if (run.winningCandidateId && input.candidates.some((c) => c.scenariosPassed !== null)) return "verified";
    if (BUILD_STATES.has(run.status)) return "building";
  }
  if (input.hasSpec) return "discovered";
  if (input.discovery?.status === "failed") return "failed";
  if (input.discovery?.status === "done" && input.discovery.decision === "none") return "not_warranted";
  return "discovering";
}
