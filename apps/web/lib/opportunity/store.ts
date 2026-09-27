/**
 * Where a discovery run writes what happened: trajectory rows, the specification, the run's own
 * row, and the trace. The pipeline talks to this interface only. The Supabase store is the real
 * one; the memory store serves the tests and prints nothing.
 */
import type { CapabilityIR } from "@lantern/capability";
import type { Discovery, DiscoveryStage, DiscoveryStatus, TraceEvent } from "@lantern/shared";
import { serviceClient } from "../supabase";
import { emitTrace, type TraceInput } from "../trace";
import type { DescribedTrajectory } from "./describe";

/** A trace row without the ids the store already knows. */
export type OpportunityTrace = Omit<TraceInput, "projectId" | "groupId" | "conversationId" | "source"> & {
  source?: TraceInput["source"];
  /** True to attach the row to the conversation that triggered the run, so the chat's trace shows it. */
  onConversation?: boolean;
};

export type TrajectoryScore = {
  sessionId: string;
  inferredGoal: string | null;
  goalName: string | null;
  goalConfidence: number | null;
  rewardCompletion: number | null;
  rewardCoherence: number | null;
};

export type SpecInsert = {
  ir: CapabilityIR;
  model: string;
  medianInteractions: number | null;
};

export type DiscoveryPatch = {
  status?: DiscoveryStatus;
  stage?: DiscoveryStage | null;
  decision?: "capability" | "none" | null;
  reasons?: string[] | null;
  sessionCount?: number | null;
  medianManualActions?: number | null;
  medianInteractions?: number | null;
  capabilitySpecId?: string | null;
  error?: string | null;
  finishedAt?: string | null;
};

export interface OpportunityStore {
  trace(input: OpportunityTrace): Promise<void>;
  /** Idempotent on (group, session): a re-run refreshes the rows it already wrote. */
  upsertTrajectories(rows: DescribedTrajectory[]): Promise<void>;
  scoreTrajectories(scores: TrajectoryScore[]): Promise<void>;
  /** Stores the IR as the next version for the group and returns its id and version. */
  insertSpec(input: SpecInsert): Promise<{ id: string; version: number }>;
  updateDiscovery(patch: DiscoveryPatch): Promise<void>;
}

export type StoredTrace = OpportunityTrace & { source: TraceInput["source"]; at: string };

/** Everything a run wrote, kept in memory. */
export class MemoryOpportunityStore implements OpportunityStore {
  readonly events: StoredTrace[] = [];
  readonly trajectories = new Map<string, DescribedTrajectory>();
  readonly scores = new Map<string, TrajectoryScore>();
  readonly specs: (SpecInsert & { id: string; version: number })[] = [];
  discovery: DiscoveryPatch = {};

  constructor(private readonly onTrace?: (event: StoredTrace) => void) {}

  async trace(input: OpportunityTrace): Promise<void> {
    const event: StoredTrace = { ...input, source: input.source ?? "forge", at: new Date().toISOString() };
    this.events.push(event);
    this.onTrace?.(event);
  }

  async upsertTrajectories(rows: DescribedTrajectory[]): Promise<void> {
    for (const row of rows) this.trajectories.set(row.trajectory.session_id, row);
  }

  async scoreTrajectories(scores: TrajectoryScore[]): Promise<void> {
    for (const score of scores) this.scores.set(score.sessionId, score);
  }

  async insertSpec(input: SpecInsert): Promise<{ id: string; version: number }> {
    const version = this.specs.length + 1;
    const id = `spec-${version}`;
    this.specs.push({ ...input, id, version });
    return { id, version };
  }

  async updateDiscovery(patch: DiscoveryPatch): Promise<void> {
    this.discovery = { ...this.discovery, ...patch };
  }

  /** The trace titles in order, which is what most assertions read. */
  titles(kind?: TraceEvent["kind"]): string[] {
    return this.events.filter((event) => !kind || event.kind === kind).map((event) => event.title);
  }
}

const DISCOVERY_COLUMNS: Record<keyof DiscoveryPatch, string> = {
  status: "status",
  stage: "stage",
  decision: "decision",
  reasons: "reasons",
  sessionCount: "session_count",
  medianManualActions: "median_manual_actions",
  medianInteractions: "median_interactions",
  capabilitySpecId: "capability_spec_id",
  error: "error",
  finishedAt: "finished_at",
};

function toColumns<T extends object>(patch: T, columns: Record<keyof T, string>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    row[columns[key as keyof T]] = value;
  }
  return row;
}

export const DISCOVERY_SELECT =
  "id, group_id, conversation_id, trigger, status, stage, decision, reasons, session_count, median_manual_actions, median_interactions, capability_spec_id, error, created_at, updated_at, finished_at";

/** Maps a `discovery` row onto the wire shape the console and the routes consume. */
export function toDiscovery(row: Record<string, unknown>): Discovery {
  const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
  const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    conversationId: text(row.conversation_id),
    trigger: (text(row.trigger) ?? "auto") as Discovery["trigger"],
    status: (text(row.status) ?? "queued") as Discovery["status"],
    stage: text(row.stage) as Discovery["stage"],
    decision: text(row.decision) as Discovery["decision"],
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    sessionCount: num(row.session_count),
    medianManualActions: num(row.median_manual_actions),
    medianInteractions: num(row.median_interactions),
    capabilitySpecId: text(row.capability_spec_id),
    error: text(row.error),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    finishedAt: text(row.finished_at),
  };
}

/** The store backed by the database, bound to one run. */
export class SupabaseOpportunityStore implements OpportunityStore {
  constructor(
    private readonly ids: {
      projectId: string;
      groupId: string;
      discoveryId: string;
      conversationId: string | null;
    },
  ) {}

  async trace(input: OpportunityTrace): Promise<void> {
    const { onConversation, ...rest } = input;
    await emitTrace({
      ...rest,
      source: input.source ?? "forge",
      projectId: this.ids.projectId,
      groupId: this.ids.groupId,
      conversationId: onConversation ? this.ids.conversationId : null,
    });
  }

  async upsertTrajectories(rows: DescribedTrajectory[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await serviceClient()
      .from("trajectory")
      .upsert(
        rows.map(({ trajectory, manualActions, rendered }) => ({
          project_id: this.ids.projectId,
          group_id: this.ids.groupId,
          session_id: trajectory.session_id,
          distinct_id: trajectory.distinct_id ?? null,
          started_at: trajectory.opened_at,
          ended_at: trajectory.confirmed_at,
          step_count: trajectory.step_count,
          steps: trajectory.steps,
          manual_actions: manualActions,
          rendered,
          replay_url: trajectory.replay_url ?? null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "group_id,session_id" },
      );
    if (error) throw new Error(`trajectory upsert failed: ${error.message}`);
  }

  async scoreTrajectories(scores: TrajectoryScore[]): Promise<void> {
    const db = serviceClient();
    for (const score of scores) {
      const { error } = await db
        .from("trajectory")
        .update({
          inferred_goal: score.inferredGoal,
          goal_name: score.goalName,
          goal_confidence: score.goalConfidence,
          reward_completion: score.rewardCompletion,
          reward_coherence: score.rewardCoherence,
          updated_at: new Date().toISOString(),
        })
        .eq("group_id", this.ids.groupId)
        .eq("session_id", score.sessionId);
      if (error) console.error("trajectory score update failed:", error.message);
    }
  }

  async insertSpec(input: SpecInsert): Promise<{ id: string; version: number }> {
    const db = serviceClient();
    const { data: latest } = await db
      .from("capability_spec")
      .select("version")
      .eq("group_id", this.ids.groupId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = Number(latest?.version ?? 0) + 1;
    const { ir } = input;
    const { data, error } = await db
      .from("capability_spec")
      .insert({
        project_id: this.ids.projectId,
        group_id: this.ids.groupId,
        intent: ir.intent,
        version,
        spec: ir,
        summary: ir.summary ?? null,
        scenario_count: ir.success.scenarios.length,
        session_count: ir.evidence.session_count,
        median_manual_actions: ir.evidence.median_manual_actions ?? null,
        median_interactions: input.medianInteractions,
        replaces_atomic_steps: ir.granularity?.replaces_atomic_steps_median ?? null,
        model: input.model,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "the capability specification could not be stored");
    return { id: String(data.id), version };
  }

  async updateDiscovery(patch: DiscoveryPatch): Promise<void> {
    const { error } = await serviceClient()
      .from("discovery")
      .update({ ...toColumns(patch, DISCOVERY_COLUMNS), updated_at: new Date().toISOString() })
      .eq("id", this.ids.discoveryId);
    if (error) console.error("discovery update failed:", error.message);
  }
}
