/**
 * An opportunity is a request group with evidence behind it: the sessions PostHog found, the
 * capability the compiler produced, the candidates the forge built, and what happened after.
 * These are the wire shapes the console and its routes share; the tables are in
 * `docs/contracts.md`.
 */

/** One run of the opportunity pipeline: mine the sessions, compile the capability. */
export type DiscoveryStatus = "queued" | "running" | "done" | "failed";

/** What started a run: the agent noticing the gap, the user reporting it, or the console. */
export type DiscoveryTrigger = "auto" | "user" | "manual";

export type DiscoveryStage = "mining" | "compiling";

export type Discovery = {
  id: string;
  groupId: string;
  conversationId: string | null;
  trigger: DiscoveryTrigger;
  status: DiscoveryStatus;
  stage: DiscoveryStage | null;
  /** `capability` when a specification was stored, `none` when the compiler declined. */
  decision: "capability" | "none" | null;
  reasons: string[];
  sessionCount: number | null;
  /** Every manual step, scanning included: the compiler's count. */
  medianManualActions: number | null;
  /** The product's own count: seat clicks, refused clicks and passenger picks. */
  medianInteractions: number | null;
  capabilitySpecId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

/**
 * Where an opportunity has got to, in the order the story runs. Derived from the rows, never
 * stored: the discovery, the specification, the forge run, the pull request, the outcome.
 */
export type OpportunityStatus =
  | "discovering"
  | "not_warranted"
  | "failed"
  | "discovered"
  | "building"
  | "verified"
  | "pr_open"
  | "merged"
  | "measured";

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
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

/** One row of the Opportunities list. */
export type OpportunitySummary = {
  groupId: string;
  /** The specification's summary when there is one, else the request group's title. */
  title: string;
  intent: string | null;
  status: OpportunityStatus;
  sessionCount: number | null;
  medianManualActions: number | null;
  medianInteractions: number | null;
  scenarioCount: number | null;
  specVersion: number | null;
  reportCount: number;
  prUrl: string | null;
  escalationId: string | null;
  updatedAt: string;
};

/** The 30-day outcome of a shipped capability. `source` says whether it was measured or seeded. */
export type DeploymentOutcome = {
  id: string;
  measuredAt: string;
  windowDays: number;
  eligibleUsers: number | null;
  featureUsed: number | null;
  featureSucceeded: number | null;
  medianActionsBefore: number | null;
  medianActionsAfter: number | null;
  supportChangePct: number | null;
  source: "seeded" | "posthog";
};
