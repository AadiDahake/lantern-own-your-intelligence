/**
 * Reads for the Opportunities pages: the list, and one opportunity with everything behind it.
 *
 * Every query is scoped to the project id the caller resolved. The detail joins five things by
 * group id: the request group, the newest discovery, the newest specification, the newest forge
 * run with its candidates, and the newest outcome.
 */
import type { CapabilityIR, EvidenceTrajectory } from "@lantern/capability";
import type { RenderedStep } from "./describe";
import type { DeploymentOutcome, Discovery, OpportunitySummary, RequestGroup } from "@lantern/shared";
import { toRequestGroup } from "../console/groups";
import { CANDIDATE_SELECT, toCandidateRow, type CandidateRow } from "../forge/store";
import { serviceClient } from "../supabase";
import { opportunityStatus } from "./status";
import { DISCOVERY_SELECT, toDiscovery } from "./store";

const GROUP_COLUMNS =
  "id, title, description, area, report_count, user_report_count, priority, status, issue_url, issue_number, pr_url, escalation_id, first_seen, last_seen";

const SPEC_COLUMNS =
  "id, group_id, intent, version, spec, summary, scenario_count, session_count, median_manual_actions, median_interactions, replaces_atomic_steps, model, created_at";

const ESCALATION_COLUMNS =
  "id, group_id, status, pr_url, pr_number, branch, deployment_url, winning_candidate_id, capability_spec_id, approval, error, created_at, updated_at";

const OUTCOME_COLUMNS =
  "id, group_id, measured_at, window_days, eligible_users, feature_used, feature_succeeded, median_actions_before, median_actions_after, support_change_pct, source";

export type SpecRow = {
  id: string;
  groupId: string;
  intent: string;
  version: number;
  ir: CapabilityIR;
  summary: string | null;
  scenarioCount: number;
  sessionCount: number;
  medianManualActions: number | null;
  medianInteractions: number | null;
  replacesAtomicSteps: number | null;
  model: string | null;
  createdAt: string;
};

export type ForgeRun = {
  id: string;
  status: string;
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  deploymentUrl: string | null;
  winningCandidateId: string | null;
  capabilitySpecId: string | null;
  approval: { approved?: boolean; note?: string; decidedAt?: string } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string | null;
};

/** One of the three sessions the Evidence card shows, rendered as steps. */
export type RepresentativeTrajectory = {
  sessionId: string;
  label: string;
  replayUrl: string | null;
  steps: RenderedStep[];
  manualActions: number;
  refusals: number;
  reward: { completion: number | null; coherence: number | null } | null;
};

export type OpportunityDetail = {
  group: RequestGroup;
  status: OpportunitySummary["status"];
  discovery: Discovery | null;
  spec: SpecRow | null;
  evidence: {
    sessionCount: number | null;
    medianManualActions: number | null;
    medianInteractions: number | null;
    replayCount: number;
    poolCount: number;
    representative: RepresentativeTrajectory[];
  };
  intent: {
    sentence: string | null;
    name: string | null;
    sessions: number;
    completion: Record<string, number>;
    coherence: Record<string, number>;
  };
  forge: { run: ForgeRun | null; candidates: CandidateRow[] };
  outcome: DeploymentOutcome | null;
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toSpec(row: Record<string, unknown>): SpecRow {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    intent: String(row.intent),
    version: Number(row.version ?? 1),
    ir: row.spec as CapabilityIR,
    summary: text(row.summary),
    scenarioCount: Number(row.scenario_count ?? 0),
    sessionCount: Number(row.session_count ?? 0),
    medianManualActions: num(row.median_manual_actions),
    medianInteractions: num(row.median_interactions),
    replacesAtomicSteps: num(row.replaces_atomic_steps),
    model: text(row.model),
    createdAt: String(row.created_at ?? ""),
  };
}

function toForgeRun(row: Record<string, unknown>): ForgeRun {
  return {
    id: String(row.id),
    status: String(row.status ?? "queued"),
    prUrl: text(row.pr_url),
    prNumber: num(row.pr_number),
    branch: text(row.branch),
    deploymentUrl: text(row.deployment_url),
    winningCandidateId: text(row.winning_candidate_id),
    capabilitySpecId: text(row.capability_spec_id),
    approval: (row.approval ?? null) as ForgeRun["approval"],
    error: text(row.error),
    createdAt: String(row.created_at ?? ""),
    updatedAt: text(row.updated_at),
  };
}

export function toOutcome(row: Record<string, unknown>): DeploymentOutcome {
  return {
    id: String(row.id),
    measuredAt: String(row.measured_at ?? ""),
    windowDays: Number(row.window_days ?? 30),
    eligibleUsers: num(row.eligible_users),
    featureUsed: num(row.feature_used),
    featureSucceeded: num(row.feature_succeeded),
    medianActionsBefore: num(row.median_actions_before),
    medianActionsAfter: num(row.median_actions_after),
    supportChangePct: num(row.support_change_pct),
    source: String(row.source ?? "seeded") === "posthog" ? "posthog" : "seeded",
  };
}

/** Keeps the first row per group, which is the newest when the query ordered newest first. */
function newestPerGroup<T extends { groupId: string }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) if (!out.has(row.groupId)) out.set(row.groupId, row);
  return out;
}

/** Every group with a discovery, a specification or a forge run, newest activity first. */
export async function loadOpportunities(projectId: string): Promise<OpportunitySummary[]> {
  const db = serviceClient();
  const [groups, discoveries, specs, runs, outcomes] = await Promise.all([
    db.from("feature_request_group").select(GROUP_COLUMNS).eq("project_id", projectId),
    db.from("discovery").select(DISCOVERY_SELECT).eq("project_id", projectId).order("created_at", { ascending: false }),
    db
      .from("capability_spec")
      .select("id, group_id, intent, version, summary, scenario_count, session_count, median_manual_actions, median_interactions, created_at")
      .eq("project_id", projectId)
      .order("version", { ascending: false }),
    db.from("escalation").select(ESCALATION_COLUMNS).eq("project_id", projectId).eq("engine", "forge").order("created_at", { ascending: false }),
    db.from("deployment_outcome").select("group_id").eq("project_id", projectId),
  ]);
  for (const result of [groups, discoveries, specs, runs, outcomes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const discoveryByGroup = newestPerGroup((discoveries.data ?? []).map((row) => toDiscovery(row as Record<string, unknown>)));
  const specByGroup = newestPerGroup(
    (specs.data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        groupId: String(r.group_id),
        intent: String(r.intent),
        version: Number(r.version ?? 1),
        summary: text(r.summary),
        scenarioCount: Number(r.scenario_count ?? 0),
        sessionCount: Number(r.session_count ?? 0),
        medianManualActions: num(r.median_manual_actions),
        medianInteractions: num(r.median_interactions),
        createdAt: String(r.created_at ?? ""),
      };
    }),
  );
  const runByGroup = newestPerGroup(
    (runs.data ?? [])
      .filter((row) => (row as Record<string, unknown>).group_id)
      .map((row) => ({ groupId: String((row as Record<string, unknown>).group_id), run: toForgeRun(row as Record<string, unknown>) })),
  );
  const runIds = [...runByGroup.values()].map((entry) => entry.run.id);
  const candidates = runIds.length
    ? await db.from("candidate").select("escalation_id, status, scenarios_passed").in("escalation_id", runIds)
    : { data: [], error: null };
  if (candidates.error) throw new Error(candidates.error.message);
  const candidatesByRun = new Map<string, { status: string; scenariosPassed: number | null }[]>();
  for (const row of candidates.data ?? []) {
    const r = row as Record<string, unknown>;
    const list = candidatesByRun.get(String(r.escalation_id)) ?? [];
    list.push({ status: String(r.status ?? "queued"), scenariosPassed: num(r.scenarios_passed) });
    candidatesByRun.set(String(r.escalation_id), list);
  }
  const outcomeGroups = new Set((outcomes.data ?? []).map((row) => String((row as Record<string, unknown>).group_id)));

  const summaries: OpportunitySummary[] = [];
  for (const raw of groups.data ?? []) {
    const group = toRequestGroup(raw as Record<string, unknown>);
    const discovery = discoveryByGroup.get(group.id) ?? null;
    const spec = specByGroup.get(group.id) ?? null;
    const run = runByGroup.get(group.id)?.run ?? null;
    if (!discovery && !spec && !run) continue;
    const status = opportunityStatus({
      discovery,
      hasSpec: spec !== null,
      escalation: run ? { status: run.status, prUrl: run.prUrl, winningCandidateId: run.winningCandidateId } : null,
      candidates: run ? (candidatesByRun.get(run.id) ?? []) : [],
      hasOutcome: outcomeGroups.has(group.id),
    });
    const updatedAt = [discovery?.updatedAt, spec?.createdAt, run?.updatedAt ?? run?.createdAt, group.lastSeen]
      .filter((value): value is string => Boolean(value))
      .sort()
      .reverse()[0] as string;
    summaries.push({
      groupId: group.id,
      title: spec?.summary?.trim() || group.title,
      intent: spec?.intent ?? null,
      status,
      sessionCount: spec?.sessionCount ?? discovery?.sessionCount ?? null,
      medianManualActions: spec?.medianManualActions ?? discovery?.medianManualActions ?? null,
      medianInteractions: spec?.medianInteractions ?? discovery?.medianInteractions ?? null,
      scenarioCount: spec?.scenarioCount ?? null,
      specVersion: spec?.version ?? null,
      reportCount: group.reportCount,
      prUrl: run?.prUrl ?? group.prUrl,
      escalationId: run?.id ?? group.escalationId,
      updatedAt,
    });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function refusalsOf(steps: EvidenceTrajectory["steps"]): number {
  return steps.filter((step) => step.event === "seat_selection_rejected").length;
}

/** What the pipeline stored per session: the compiler's own count and its own prose. */
export type DescribedRow = { manualActions: number; rendered: RenderedStep[] };

function isRenderedStep(value: unknown): value is RenderedStep {
  const row = value as { line?: unknown; seconds?: unknown };
  return typeof row?.line === "string" && typeof row?.seconds === "number";
}

/** A row's rendering, or the bare event names when the row predates the rendering. */
function renderedOf(row: DescribedRow | undefined, trajectory: EvidenceTrajectory): RenderedStep[] {
  if (row && row.rendered.length === trajectory.steps.length) return row.rendered;
  return trajectory.steps.map((step, index) => {
    const previous = trajectory.steps[index - 1];
    const seconds = previous ? Math.max(0, Math.round((Date.parse(step.t) - Date.parse(previous.t)) / 1000)) : 0;
    return { line: step.event.replace(/_/g, " "), seconds };
  });
}

/**
 * Three sessions that show the three shapes the plan describes: one that went straight to the
 * seats, one that backtracked through refusals, and one that moved each passenger in turn. The
 * supporting sessions come from the specification's evidence; the counts and the prose from the
 * rows the pipeline described.
 */
export function representativeTrajectories(
  trajectories: EvidenceTrajectory[],
  rows: Map<string, DescribedRow>,
): RepresentativeTrajectory[] {
  if (trajectories.length === 0) return [];
  const scored = trajectories.map((t) => ({
    t,
    row: rows.get(t.session_id),
    manual: rows.get(t.session_id)?.manualActions ?? t.steps.length,
    refusals: refusalsOf(t.steps),
    selections: t.steps.filter((s) => s.event === "seat_selected").length,
    coherence: t.reward?.coherence ?? 0,
  }));
  const straight = [...scored].sort((a, b) => b.coherence - a.coherence || a.manual - b.manual)[0];
  const backtracked = [...scored].filter((s) => s !== straight).sort((a, b) => b.refusals - a.refusals || b.manual - a.manual)[0];
  const moved = [...scored]
    .filter((s) => s !== straight && s !== backtracked)
    .sort((a, b) => b.selections - a.selections || Math.abs(a.manual - 14) - Math.abs(b.manual - 14))[0];
  const picks = [
    straight ? { ...straight, label: "Straight to the seats" } : null,
    backtracked ? { ...backtracked, label: `Backtracked through ${backtracked.refusals} refusal${backtracked.refusals === 1 ? "" : "s"}` } : null,
    moved ? { ...moved, label: "Moved each passenger in turn" } : null,
  ].filter((pick): pick is NonNullable<typeof pick> => pick !== null);
  return picks.map((pick) => ({
    sessionId: pick.t.session_id,
    label: pick.label,
    replayUrl: pick.t.replay_url ?? null,
    steps: renderedOf(pick.row, pick.t),
    manualActions: pick.manual,
    refusals: pick.refusals,
    reward: pick.t.reward ? { completion: pick.t.reward.completion ?? null, coherence: pick.t.reward.coherence ?? null } : null,
  }));
}

/** The described rows by session id, from the trajectory table's columns. */
export function describedRows(rows: Record<string, unknown>[]): Map<string, DescribedRow> {
  const out = new Map<string, DescribedRow>();
  for (const row of rows) {
    const rendered = Array.isArray(row.rendered) ? row.rendered.filter(isRenderedStep) : [];
    out.set(String(row.session_id), { manualActions: Number(row.manual_actions ?? 0), rendered });
  }
  return out;
}

function countBy(values: (number | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    if (value === null) continue;
    out[String(value)] = (out[String(value)] ?? 0) + 1;
  }
  return out;
}

/** One opportunity with everything behind it, or null when the group is not this project's. */
export async function loadOpportunity(projectId: string, groupId: string): Promise<OpportunityDetail | null> {
  const db = serviceClient();
  const { data: groupRow } = await db
    .from("feature_request_group")
    .select(GROUP_COLUMNS)
    .eq("id", groupId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!groupRow) return null;
  const group = toRequestGroup(groupRow as Record<string, unknown>);

  const [discoveryRes, specRes, runRes, outcomeRes, trajectoryRes] = await Promise.all([
    db.from("discovery").select(DISCOVERY_SELECT).eq("group_id", groupId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("capability_spec").select(SPEC_COLUMNS).eq("group_id", groupId).order("version", { ascending: false }).limit(1).maybeSingle(),
    db.from("escalation").select(ESCALATION_COLUMNS).eq("group_id", groupId).eq("engine", "forge").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("deployment_outcome").select(OUTCOME_COLUMNS).eq("group_id", groupId).order("measured_at", { ascending: false }).limit(1).maybeSingle(),
    db
      .from("trajectory")
      .select("session_id, replay_url, inferred_goal, goal_name, reward_completion, reward_coherence, manual_actions, rendered")
      .eq("group_id", groupId),
  ]);

  const discovery = discoveryRes.data ? toDiscovery(discoveryRes.data as Record<string, unknown>) : null;
  const spec = specRes.data ? toSpec(specRes.data as Record<string, unknown>) : null;
  const run = runRes.data ? toForgeRun(runRes.data as Record<string, unknown>) : null;
  const outcome = outcomeRes.data ? toOutcome(outcomeRes.data as Record<string, unknown>) : null;
  const rows = (trajectoryRes.data ?? []) as Record<string, unknown>[];

  let candidates: CandidateRow[] = [];
  if (run) {
    const { data } = await db.from("candidate").select(CANDIDATE_SELECT).eq("escalation_id", run.id).order("started_at", { ascending: true });
    candidates = (data ?? []).map((row) => toCandidateRow(row as Record<string, unknown>));
  }

  const status = opportunityStatus({
    discovery,
    hasSpec: spec !== null,
    escalation: run ? { status: run.status, prUrl: run.prUrl, winningCandidateId: run.winningCandidateId } : null,
    candidates: candidates.map((c) => ({ status: c.status, scenariosPassed: c.scenariosPassed })),
    hasOutcome: outcome !== null,
  });

  // The leading goal: the name most rows carry, and the sentence stored beside it.
  const goalCounts = countBy(rows.map((row) => (row.goal_name ? 1 : null)));
  const names = new Map<string, number>();
  for (const row of rows) {
    const name = text(row.goal_name);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  const leading = [...names.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const sentence = leading ? (rows.find((row) => text(row.goal_name) === leading[0] && row.inferred_goal)?.inferred_goal ?? null) : null;
  void goalCounts;

  return {
    group,
    status,
    discovery,
    spec,
    evidence: {
      sessionCount: spec?.sessionCount ?? discovery?.sessionCount ?? null,
      medianManualActions: spec?.medianManualActions ?? discovery?.medianManualActions ?? null,
      medianInteractions: spec?.medianInteractions ?? discovery?.medianInteractions ?? null,
      replayCount: rows.filter((row) => row.replay_url).length,
      poolCount: rows.length,
      representative: spec ? representativeTrajectories(spec.ir.evidence.trajectories, describedRows(rows)) : [],
    },
    intent: {
      sentence: typeof sentence === "string" ? sentence : null,
      name: leading?.[0] ?? spec?.intent ?? null,
      sessions: leading?.[1] ?? 0,
      completion: countBy(rows.map((row) => num(row.reward_completion))),
      coherence: countBy(rows.map((row) => num(row.reward_coherence))),
    },
    forge: { run, candidates },
    outcome,
  };
}
