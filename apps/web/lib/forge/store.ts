/**
 * Where a run writes what happened: candidate rows, the escalation, the group, and the trace.
 *
 * The engine talks to this interface only. The Supabase store is the real one; the memory store
 * serves the tests and the command-line run, which have no database and print the trace instead.
 */
import type { TraceEvent } from "@lantern/shared";
import { serviceClient } from "../supabase";
import { emitTrace, type TraceInput } from "../trace";

export type CandidateStatus =
  | "queued"
  | "provisioning"
  | "building"
  | "testing"
  | "ready"
  | "failed"
  | "torn_down";

export type CandidateRow = {
  id: string;
  label: string;
  persona: string;
  strategy: string;
  status: CandidateStatus;
  devboxId: string | null;
  blueprintName: string | null;
  tunnelKey: string | null;
  localPath: string | null;
  previewPort: number | null;
  codexThreadId: string | null;
  codexExitCode: number | null;
  branch: string | null;
  scenariosPassed: number | null;
  scenariosTotal: number | null;
  failingScenarios: string[] | null;
  testReport: unknown;
  changedFiles: { path: string; kind: string }[] | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  tornDownAt: string | null;
};

export type CandidatePatch = Partial<Omit<CandidateRow, "id" | "label" | "startedAt">>;

export type EscalationPatch = {
  status?: string;
  prUrl?: string | null;
  prNumber?: number | null;
  branch?: string | null;
  deploymentUrl?: string | null;
  winningCandidateId?: string | null;
  error?: string | null;
};

export type GroupPatch = { status?: string; prUrl?: string | null };

/** A trace row without the ids the store already knows. */
export type ForgeTrace = Omit<TraceInput, "projectId" | "escalationId" | "source"> & {
  source?: TraceInput["source"];
};

export interface ForgeStore {
  trace(input: ForgeTrace): Promise<void>;
  insertCandidate(input: {
    label: string;
    strategy: string;
    capabilitySpecId: string | null;
    branch: string;
  }): Promise<string>;
  updateCandidate(id: string, patch: CandidatePatch): Promise<void>;
  updateEscalation(patch: EscalationPatch): Promise<void>;
  updateGroup(patch: GroupPatch): Promise<void>;
}

/** Everything a run wrote, kept in memory. */
export class MemoryForgeStore implements ForgeStore {
  readonly events: (ForgeTrace & { source: TraceInput["source"]; at: string })[] = [];
  readonly candidates = new Map<string, CandidateRow>();
  escalation: EscalationPatch = {};
  group: GroupPatch = {};
  private counter = 0;

  constructor(private readonly onTrace?: (event: ForgeTrace & { source: TraceInput["source"] }) => void) {}

  async trace(input: ForgeTrace): Promise<void> {
    const event = { ...input, source: input.source ?? "forge", at: new Date().toISOString() };
    this.events.push(event);
    this.onTrace?.(event);
  }

  async insertCandidate(input: {
    label: string;
    strategy: string;
    capabilitySpecId: string | null;
    branch: string;
  }): Promise<string> {
    this.counter += 1;
    const id = `candidate-${this.counter}`;
    this.candidates.set(id, {
      id,
      label: input.label,
      persona: "capability_builder",
      strategy: input.strategy,
      status: "queued",
      devboxId: null,
      blueprintName: null,
      tunnelKey: null,
      localPath: null,
      previewPort: null,
      codexThreadId: null,
      codexExitCode: null,
      branch: input.branch,
      scenariosPassed: null,
      scenariosTotal: null,
      failingScenarios: null,
      testReport: null,
      changedFiles: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tornDownAt: null,
    });
    return id;
  }

  async updateCandidate(id: string, patch: CandidatePatch): Promise<void> {
    // A row this process did not insert (an approval in another process) is still a row.
    const row = this.candidates.get(id) ?? this.blankCandidate(id);
    this.candidates.set(id, { ...row, ...patch });
  }

  private blankCandidate(id: string): CandidateRow {
    return {
      id,
      label: "?",
      persona: "capability_builder",
      strategy: "fake",
      status: "queued",
      devboxId: null,
      blueprintName: null,
      tunnelKey: null,
      localPath: null,
      previewPort: null,
      codexThreadId: null,
      codexExitCode: null,
      branch: null,
      scenariosPassed: null,
      scenariosTotal: null,
      failingScenarios: null,
      testReport: null,
      changedFiles: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tornDownAt: null,
    };
  }

  async updateEscalation(patch: EscalationPatch): Promise<void> {
    this.escalation = { ...this.escalation, ...patch };
  }

  async updateGroup(patch: GroupPatch): Promise<void> {
    this.group = { ...this.group, ...patch };
  }

  /** The trace titles in order, which is what most assertions read. */
  titles(kind?: TraceEvent["kind"]): string[] {
    return this.events.filter((event) => !kind || event.kind === kind).map((event) => event.title);
  }
}

const CANDIDATE_COLUMNS: Record<keyof CandidatePatch, string> = {
  persona: "persona",
  strategy: "strategy",
  status: "status",
  devboxId: "devbox_id",
  blueprintName: "blueprint_name",
  tunnelKey: "tunnel_key",
  localPath: "local_path",
  previewPort: "preview_port",
  codexThreadId: "codex_thread_id",
  codexExitCode: "codex_exit_code",
  branch: "branch",
  scenariosPassed: "scenarios_passed",
  scenariosTotal: "scenarios_total",
  failingScenarios: "failing_scenarios",
  testReport: "test_report",
  changedFiles: "changed_files",
  error: "error",
  finishedAt: "finished_at",
  tornDownAt: "torn_down_at",
};

const ESCALATION_COLUMNS: Record<keyof EscalationPatch, string> = {
  status: "status",
  prUrl: "pr_url",
  prNumber: "pr_number",
  branch: "branch",
  deploymentUrl: "deployment_url",
  winningCandidateId: "winning_candidate_id",
  error: "error",
};

function toColumns<T extends object>(patch: T, columns: Record<keyof T, string>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    row[columns[key as keyof T]] = value;
  }
  return row;
}

/** Maps a `candidate` row onto the wire shape the console and the routes consume. */
export function toCandidateRow(row: Record<string, unknown>): CandidateRow {
  const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
  const int = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
  return {
    id: String(row.id),
    label: String(row.label),
    persona: String(row.persona ?? "capability_builder"),
    strategy: String(row.strategy ?? "runloop"),
    status: String(row.status ?? "queued") as CandidateStatus,
    devboxId: text(row.devbox_id),
    blueprintName: text(row.blueprint_name),
    tunnelKey: text(row.tunnel_key),
    localPath: text(row.local_path),
    previewPort: int(row.preview_port),
    codexThreadId: text(row.codex_thread_id),
    codexExitCode: int(row.codex_exit_code),
    branch: text(row.branch),
    scenariosPassed: int(row.scenarios_passed),
    scenariosTotal: int(row.scenarios_total),
    failingScenarios: Array.isArray(row.failing_scenarios) ? row.failing_scenarios.map(String) : null,
    testReport: row.test_report ?? null,
    changedFiles: Array.isArray(row.changed_files)
      ? (row.changed_files as { path: string; kind: string }[])
      : null,
    error: text(row.error),
    startedAt: String(row.started_at ?? ""),
    finishedAt: text(row.finished_at),
    tornDownAt: text(row.torn_down_at),
  };
}

export const CANDIDATE_SELECT =
  "id, label, persona, strategy, status, devbox_id, blueprint_name, tunnel_key, local_path, preview_port, codex_thread_id, codex_exit_code, branch, scenarios_passed, scenarios_total, failing_scenarios, test_report, changed_files, error, started_at, finished_at, torn_down_at";

/** The store backed by the database, bound to one run. */
export class SupabaseForgeStore implements ForgeStore {
  constructor(
    private readonly ids: { projectId: string; escalationId: string; groupId: string | null },
  ) {}

  async trace(input: ForgeTrace): Promise<void> {
    await emitTrace({
      ...input,
      source: input.source ?? "forge",
      projectId: this.ids.projectId,
      escalationId: this.ids.escalationId,
    });
  }

  async insertCandidate(input: {
    label: string;
    strategy: string;
    capabilitySpecId: string | null;
    branch: string;
  }): Promise<string> {
    const { data, error } = await serviceClient()
      .from("candidate")
      .insert({
        project_id: this.ids.projectId,
        escalation_id: this.ids.escalationId,
        capability_spec_id: input.capabilitySpecId,
        label: input.label,
        strategy: input.strategy,
        branch: input.branch,
        status: "queued",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "the candidate could not be recorded");
    return String(data.id);
  }

  async updateCandidate(id: string, patch: CandidatePatch): Promise<void> {
    const { error } = await serviceClient()
      .from("candidate")
      .update(toColumns(patch, CANDIDATE_COLUMNS))
      .eq("id", id);
    if (error) console.error("candidate update failed:", error.message);
  }

  async updateEscalation(patch: EscalationPatch): Promise<void> {
    const { error } = await serviceClient()
      .from("escalation")
      .update({ ...toColumns(patch, ESCALATION_COLUMNS), updated_at: new Date().toISOString() })
      .eq("id", this.ids.escalationId);
    if (error) console.error("escalation update failed:", error.message);
  }

  async updateGroup(patch: GroupPatch): Promise<void> {
    if (!this.ids.groupId) return;
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.prUrl !== undefined) row.pr_url = patch.prUrl;
    const { error } = await serviceClient()
      .from("feature_request_group")
      .update(row)
      .eq("id", this.ids.groupId);
    if (error) console.error("group update failed:", error.message);
  }
}

/** Every candidate of one run, oldest first. */
export async function loadCandidates(escalationId: string): Promise<CandidateRow[]> {
  const { data, error } = await serviceClient()
    .from("candidate")
    .select(CANDIDATE_SELECT)
    .eq("escalation_id", escalationId)
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toCandidateRow(row as Record<string, unknown>));
}
