/**
 * The Reflex strategy: the three personas launched by id on Reflex, each in a devbox seeded from
 * the previous persona's snapshot.
 *
 * A candidate is a chain of three Reflex agents. The Capability Builder launches from its persona
 * with the target repository attached. When it completes, its disk is snapshotted (Reflex ends the
 * run and shuts that box down) and the UX Builder launches from the same persona id on that
 * snapshot; the Capability Verifier follows the same way. Every event the agents emit is read from
 * `/agents/{id}/stream` and written to the trace. The Verifier's devbox stays up: the repository's
 * own tests, the preview and the push run on it through the Runloop API, which is the one thing
 * Reflex does not expose on an agent. Peak devboxes per candidate: one.
 */
import { RunloopSDK } from "@runloop/api-client";
import type { CodexRunSummary } from "./codex";
import type { FileUpdateChange } from "./codex-events";
import type { PersonaKey } from "./personas";
import { isServing, tunnelUrl } from "./preview";
import { payloadText, ReflexClient, type ReflexAgent, type ReflexEvent } from "./reflex-client";
import { RunloopSandbox, KEY_ENV, PREVIEW_PORT } from "./runloop";
import { truncate } from "./shell";
import type { ForgeTrace } from "./store";
import type {
  CandidateSeed,
  DraftPr,
  DraftPrInput,
  ExecOptions,
  ExecResult,
  PersonaRunRequest,
  PersonaRunResult,
  Sandbox,
  SandboxHandle,
  SandboxStrategy,
  TargetRepo,
} from "./strategy";

export type ReflexStrategyOptions = {
  reflex: ReflexClient;
  personaIds: Record<PersonaKey, string>;
  /** The Runloop key for the agent's devbox: tests, preview, push. Same account as Reflex. */
  runloopApiKey: string;
  /** How long a finished agent's devbox stays up for the preview. */
  idleTimeMinutes?: number;
  pollMs?: number;
  agentTimeoutMs?: number;
  log?: (line: string) => void;
};

const TERMINAL: ReadonlySet<string> = new Set(["completed", "stopped", "error", "terminated", "interrupted"]);
const NUDGE = "Continue without asking. Make the decision yourself, follow the persona instructions, and finish.";
const DEFAULT_IDLE_MINUTES = 90;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One Reflex event as a trace row, or null for chatter the console does not need. */
export function traceForReflexEvent(
  event: ReflexEvent,
  context: { persona: string; candidate: string },
): ForgeTrace | null {
  const prefix = `${context.persona} (${context.candidate})`;
  const base = { persona: context.persona, candidate: context.candidate, reflex_event: event.type, sequence: event.sequence ?? null };
  const text = payloadText(event.payload);
  const summary = text ? truncate(text, 96) : event.type;
  const detail = { ...base, payload: event.payload };

  switch (event.type) {
    case "turn.tool_call":
    case "tool_call":
    case "agent.tool_use":
      return {
        kind: "tool",
        status: "ok",
        title: `${prefix}: ${summary}`,
        detail: { ...base, tool: "reflex", transport: "shell", args_summary: text ?? event.type, result_summary: "", payload: event.payload },
      };
    case "codex.command.result":
      return {
        kind: "tool",
        status: "ok",
        title: `${prefix}: ${summary}`,
        detail: { ...base, tool: "codex", transport: "shell", args_summary: text ?? "", result_summary: "", payload: event.payload },
      };
    case "agent.plan":
    case "agent.progress":
    case "agent.setup":
    case "agent.status_change":
    case "agent.dev_server":
    case "agent.daemon_started":
    case "devbox.running":
    case "devbox.suspended":
    case "devbox.shutdown":
    case "agent.started":
    case "agent.complete":
      return { kind: "status", status: "ok", title: `${prefix}: ${summary}`, detail };
    case "assistant":
    case "turn.completed":
      return text
        ? { kind: "model", status: "ok", title: `${prefix}: ${summary}`, detail: { ...base, model: "reflex", purpose: context.persona, output_summary: text.slice(0, 2000) } }
        : null;
    case "agent.pr_created":
      return { kind: "artifact", status: "ok", title: `${prefix}: opened a pull request`, detail: { ...base, artifact: "pr", url: text, payload: event.payload } };
    case "agent.error":
    case "turn.failed":
    case "error":
    case "devbox.failed":
      return { kind: "error", status: "failed", title: `${prefix}: ${summary}`, detail };
    default:
      return null;
  }
}

/** The changed files of a checkout, from git itself, as Codex's `file_change` shape. */
function parseStatus(porcelain: string): FileUpdateChange[] {
  const changes: FileUpdateChange[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).trim().split(" -> ").pop() ?? "";
    if (!path || path.startsWith(".lantern/")) continue;
    const kind: FileUpdateChange["kind"] = code.includes("D") ? "delete" : code.includes("?") || code.includes("A") ? "add" : "update";
    changes.push({ path, kind });
  }
  return changes;
}

export class ReflexStrategy implements SandboxStrategy {
  readonly name = "reflex" as const;
  private readonly sdk: RunloopSDK;

  constructor(private readonly options: ReflexStrategyOptions) {
    this.sdk = new RunloopSDK({ bearerToken: options.runloopApiKey });
  }

  async previewPort(): Promise<number> {
    return PREVIEW_PORT;
  }

  async provision(candidate: CandidateSeed, repo: TargetRepo): Promise<Sandbox> {
    // No box exists until the first persona launches: the persona's launch is what creates it.
    return new ReflexSandbox(candidate, repo, this.options, this.sdk);
  }

  async previewUrl(handle: SandboxHandle, port: number): Promise<string | null> {
    if (!handle.devboxId || !handle.tunnelKey) return null;
    const info = await this.sdk.devbox.fromId(handle.devboxId).getInfo().catch(() => null);
    if (!info || info.status !== "running") return null;
    const url = tunnelUrl(handle.previewPort ?? port, handle.tunnelKey);
    return (await isServing(url)) ? url : null;
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    if (handle.agentId) {
      await this.options.reflex.stopAgent(handle.agentId).catch(() => undefined);
    }
    if (handle.devboxId) {
      await this.sdk.devbox.fromId(handle.devboxId).shutdown().catch(() => undefined);
    }
  }
}

class ReflexSandbox implements Sandbox {
  readonly handle: SandboxHandle;
  readonly writableRoots: string[] = [];
  repoDir: string;
  private agent: ReflexAgent | null = null;
  private inner: RunloopSandbox | null = null;
  private readonly pendingFiles = new Map<string, string>();
  private readonly snapshots: string[] = [];
  private tornDown = false;

  constructor(
    private readonly candidate: CandidateSeed,
    private readonly repo: TargetRepo,
    private readonly options: ReflexStrategyOptions,
    private readonly sdk: RunloopSDK,
  ) {
    this.handle = { strategy: "reflex", agentId: null, devboxId: null, tunnelKey: null, localPath: null, previewPort: null };
    this.repoDir = `/home/user/${repo.name}`;
  }

  private log(line: string): void {
    this.options.log?.(`[reflex ${this.candidate.label}] ${line}`);
  }

  /** The Runloop view of the agent's current devbox, for what Reflex does not do on an agent. */
  private box(): RunloopSandbox {
    if (!this.agent?.devboxId) throw new Error("No Reflex agent has a devbox yet for this candidate.");
    if (!this.inner || this.inner.handle.devboxId !== this.agent.devboxId) {
      this.inner = new RunloopSandbox(
        this.handle,
        this.sdk.devbox.fromId(this.agent.devboxId),
        this.repoDir,
        this.repo,
        this.candidate,
        { log: this.options.log },
      );
    }
    return this.inner;
  }

  private adopt(agent: ReflexAgent): void {
    this.agent = agent;
    this.handle.agentId = agent.id;
    this.handle.devboxId = agent.devboxId;
    this.handle.tunnelKey = agent.tunnelKey ?? this.handle.tunnelKey ?? null;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return this.box().exec(command, options);
  }

  async writeFile(path: string, contents: string): Promise<void> {
    if (!this.agent?.devboxId) {
      this.pendingFiles.set(path, contents);
      return;
    }
    await this.box().writeFile(path, contents);
  }

  async readFile(path: string): Promise<string> {
    if (!this.agent?.devboxId) {
      const pending = this.pendingFiles.get(path);
      if (pending !== undefined) return pending;
      throw new Error(`No devbox yet, so ${path} cannot be read.`);
    }
    return this.box().readFile(path);
  }

  /** The launch prompt: the run's context plus the files the persona expects under `.lantern/`. */
  private launchPrompt(request: PersonaRunRequest): string {
    const parts = [request.prompt.trim(), "", "# Files", ""];
    parts.push(
      "The files below belong under `.lantern/` at the repository root. If `.lantern/spec.json` does not exist yet, write every file below to that path first, exactly as given.",
      "",
    );
    for (const [path, contents] of this.pendingFiles) {
      const fence = path.endsWith(".json") ? "json" : "markdown";
      parts.push(`## ${path}`, "", `\`\`\`${fence}`, contents.trim(), "```", "");
    }
    return parts.join("\n");
  }

  private async waitForSnapshot(agentId: string, name: string): Promise<string> {
    const snapshot = await this.options.reflex.snapshotAgent(agentId, name, `Lantern candidate ${this.candidate.label}: ${name}`);
    this.snapshots.push(snapshot.id);
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const status = await this.options.reflex.snapshotStatus(snapshot.id);
      if (status.status === "complete") return snapshot.id;
      if (status.status === "error" || status.status === "deleted") {
        throw new Error(`Snapshot ${snapshot.id} ended in ${status.status}: ${status.errorMessage ?? ""}`);
      }
      await sleep(this.options.pollMs ?? 5_000);
    }
    throw new Error(`Snapshot ${snapshot.id} did not complete in time.`);
  }

  async runPersona(request: PersonaRunRequest): Promise<PersonaRunResult> {
    const { persona } = request;
    const personaId = this.options.personaIds[persona.key];
    const name = `lantern ${this.candidate.label} ${persona.name}`;
    const context = { persona: persona.name, candidate: this.candidate.label };
    const sandboxOptions = {
      resourceSize: persona.sandboxOptions.resourceSize,
      idleTimeMinutes: this.options.idleTimeMinutes ?? DEFAULT_IDLE_MINUTES,
    };

    let agent: ReflexAgent;
    if (!this.agent) {
      this.log(`launching persona ${personaId} on ${this.repo.fullName}@${this.repo.defaultBranch}`);
      agent = await this.options.reflex.launchPersona(personaId, {
        prompt: this.launchPrompt(request),
        promptStrategy: "prepend-default",
        promptMode: persona.promptMode,
        name,
        repoSlug: this.repo.fullName,
        repoBranch: this.repo.defaultBranch,
        sandboxOptions,
      });
    } else {
      // The next persona starts where the last one stopped: on a snapshot of its disk.
      const snapshotId = await this.waitForSnapshot(this.agent.id, `lantern-${this.candidate.label.toLowerCase()}-${persona.key}`);
      request.onTrace({
        kind: "status",
        status: "ok",
        title: `Candidate ${this.candidate.label}: snapshot ${snapshotId} taken for the ${persona.name}`,
        detail: { candidate: this.candidate.label, snapshot: snapshotId, persona: persona.key },
      });
      this.inner = null;
      agent = await this.options.reflex.launchPersona(personaId, {
        prompt: this.launchPrompt(request),
        promptStrategy: "prepend-default",
        promptMode: persona.promptMode,
        name,
        sandboxOptions: { ...sandboxOptions, snapshotId },
      });
    }
    this.adopt(agent);
    request.onTrace({
      kind: "status",
      status: "running",
      title: `Candidate ${this.candidate.label}: Reflex agent ${agent.id} launched from persona ${personaId}`,
      detail: { candidate: this.candidate.label, agent: agent.id, persona: personaId, stream: agent.streamId },
    });

    const summary: CodexRunSummary = {
      threadId: agent.id,
      changedFiles: [],
      commands: 0,
      failedCommands: 0,
      usage: null,
      lastMessage: null,
      failure: null,
      noise: [],
    };
    const finished = await this.follow(agent.id, context, request, summary);
    this.adopt(finished);

    if (this.pendingFiles.size > 0 && finished.devboxId) {
      // The agent was told to write these; make sure of it before the next persona reads them.
      for (const [path, contents] of this.pendingFiles) {
        await this.box().writeFile(path, contents).catch((error: Error) => this.log(`could not write ${path}: ${error.message}`));
      }
      this.pendingFiles.clear();
    }
    if (finished.devboxId) {
      const status = await this.exec("git status --porcelain").catch(() => null);
      if (status && status.exitCode === 0) summary.changedFiles = parseStatus(status.stdout);
    }

    const failed = finished.status === "error" || finished.status === "terminated" || finished.status === "interrupted";
    if (failed) summary.failure = summary.failure ?? `Reflex agent ${finished.id} ended in ${finished.status}`;
    return { exitCode: failed ? 1 : 0, summary, bypassedSandbox: false };
  }

  /** Reads the agent's events until it stops, answering one request for input on its behalf. */
  private async follow(
    agentId: string,
    context: { persona: string; candidate: string },
    request: PersonaRunRequest,
    summary: CodexRunSummary,
  ): Promise<ReflexAgent> {
    const deadline = Date.now() + (this.options.agentTimeoutMs ?? 90 * 60_000);
    let lastSeq = 0;
    let nudged = false;
    let sawComplete = false;
    let agent = await this.options.reflex.getAgent(agentId);
    while (Date.now() < deadline) {
      const events = await this.options.reflex.streamEvents(agentId, lastSeq + 1).catch(() => []);
      for (const event of events) {
        if ((event.sequence ?? 0) <= lastSeq && event.sequence !== undefined) continue;
        lastSeq = Math.max(lastSeq, event.sequence ?? lastSeq);
        const text = payloadText(event.payload);
        if (event.type === "turn.tool_call" || event.type === "tool_call" || event.type === "codex.command.result") summary.commands += 1;
        // The verifier's report is its last assistant message; the completion notice must not replace it.
        if ((event.type === "assistant" || event.type === "turn.completed" || event.type === "result") && text) summary.lastMessage = text;
        else if (event.type === "agent.complete" && text && summary.lastMessage === null) summary.lastMessage = text;
        if (event.type === "agent.complete") sawComplete = true;
        if (event.type === "agent.error" || event.type === "turn.failed" || event.type === "devbox.failed") summary.failure = text ?? event.type;
        const row = traceForReflexEvent(event, context);
        if (row) request.onTrace(row);
      }
      agent = await this.options.reflex.getAgent(agentId);
      if (this.handle.devboxId !== agent.devboxId || this.handle.tunnelKey !== agent.tunnelKey) this.adopt(agent);
      if (TERMINAL.has(agent.status)) return agent;
      if (agent.status === "needs_input") {
        if (nudged) {
          await this.options.reflex.stopAgent(agentId).catch(() => undefined);
          summary.failure = "the agent asked for input twice";
          return { ...agent, status: "error" };
        }
        nudged = true;
        await this.options.reflex.sendMessage(agentId, NUDGE).catch(() => undefined);
      }
      if (sawComplete && agent.turnState === "idle") return agent;
      await sleep(this.options.pollMs ?? 4_000);
    }
    await this.options.reflex.stopAgent(agentId).catch(() => undefined);
    summary.failure = "the agent did not finish in time";
    return { ...agent, status: "error" };
  }

  async serve(port: number): Promise<string> {
    const url = await this.box().serve(port);
    this.handle.previewPort = port;
    return url;
  }

  async pushBranch(branch: string, message: string): Promise<{ sha: string }> {
    return this.box().pushBranch(branch, message);
  }

  async openDraftPr(input: DraftPrInput): Promise<DraftPr> {
    return this.box().openDraftPr(input);
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    if (this.agent) await this.options.reflex.stopAgent(this.agent.id).catch(() => undefined);
    if (this.agent?.devboxId) await this.sdk.devbox.fromId(this.agent.devboxId).shutdown().catch(() => undefined);
    for (const snapshot of this.snapshots) {
      await this.options.reflex.deleteSnapshot(snapshot).catch((error: Error) => this.log(`snapshot ${snapshot} not deleted: ${error.message}`));
    }
  }
}

export { KEY_ENV };
