/**
 * One candidate, end to end, inside its own sandbox: provision, hand over the specification, run
 * the three personas in order, run the repository's own tests, score the result.
 *
 * A candidate that fails at any step tears its own sandbox down and reports `failed`; the other
 * candidate keeps going. A candidate that finishes keeps its sandbox alive, because the winner's
 * sandbox is the preview and the branch.
 */
import { codexCommand, codexStream, looksLikeSandboxFailure, traceForEvent, type CodexRunSummary } from "./codex";
import type { FileUpdateChange } from "./codex-events";
import { scenarioIds, type CapabilityIr } from "./ir";
import { PERSONA_ORDER, renderAcceptance, renderPrompt, type Persona, type Personas } from "./personas";
import { branchName } from "./pr";
import type { ForgeStore, ForgeTrace } from "./store";
import type { Sandbox, SandboxHandle, SandboxStrategy, TargetRepo } from "./strategy";
import { scoreVerification, type Verification } from "./verify";

export type CandidatePlan = { label: string; approach: string };

/**
 * Two candidates, two ways in. The verifier decides between them; the approaches only make sure
 * they are not the same attempt twice.
 */
export const CANDIDATE_PLANS: CandidatePlan[] = [
  {
    label: "A",
    approach:
      "Prefer the most direct composition of the existing primitives: one pass over the state that takes the first result satisfying the constraints.",
  },
  {
    label: "B",
    approach:
      "Enumerate every possible result first, reject each one that violates a constraint, then rank what remains by the preferences before choosing.",
  },
];

export type CandidateContext = {
  ir: CapabilityIr;
  repo: TargetRepo;
  escalationId: string;
  capabilitySpecId: string | null;
  personas: Personas;
  strategy: SandboxStrategy;
  store: ForgeStore;
  /** The environment variable holding the model key inside the sandbox, or null for the saved login. */
  codexApiKeyEnvVar: string | null;
  log?: (line: string) => void;
};

export type CandidateOutcome = {
  id: string;
  label: string;
  branch: string;
  status: "ready" | "failed";
  /** Alive when `ready`; the winner's becomes the preview. */
  sandbox: Sandbox | null;
  handle: SandboxHandle | null;
  verification: Verification | null;
  changedFiles: FileUpdateChange[];
  threadId: string | null;
  error: string | null;
};

/** Trace rows in the order they happened, even though the writes are asynchronous. */
class TraceQueue {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly store: ForgeStore) {}

  push(input: ForgeTrace): void {
    this.chain = this.chain.then(() => this.store.trace(input)).catch(() => undefined);
  }

  async drain(): Promise<void> {
    await this.chain;
  }
}

const TEST_REPORT = ".lantern/test-report.json";
const VERIFIER_REPORT = ".lantern/verifier-report.json";
const VERIFIER_SCHEMA = ".lantern/verifier.schema.json";

type PersonaRun = { exitCode: number; summary: CodexRunSummary; bypassedSandbox: boolean };

async function runPersona(input: {
  sandbox: Sandbox;
  persona: Persona;
  prompt: string;
  label: string;
  resumeThreadId: string | null;
  codexApiKeyEnvVar: string | null;
  trace: TraceQueue;
  log?: (line: string) => void;
}): Promise<PersonaRun> {
  const { sandbox, persona, label } = input;
  if (sandbox.runPersona) {
    const native = await sandbox.runPersona({
      persona,
      prompt: input.prompt,
      resumeThreadId: input.resumeThreadId,
      apiKeyEnvVar: input.codexApiKeyEnvVar,
      onTrace: (row) => input.trace.push(row),
      log: input.log,
    });
    await input.trace.drain();
    return native;
  }
  const promptFile = `.lantern/prompt-${persona.key}.md`;
  await sandbox.writeFile(promptFile, input.prompt);
  const lastMessageFile = persona.outputSchema ? VERIFIER_REPORT : `.lantern/last-${persona.key}.md`;
  if (persona.outputSchema) {
    await sandbox.writeFile(VERIFIER_SCHEMA, JSON.stringify(persona.outputSchema, null, 2));
  }
  const absolute = (path: string): string => `${sandbox.repoDir}/${path}`;

  const attempt = async (bypassSandbox: boolean): Promise<{ exitCode: number; summary: CodexRunSummary }> => {
    const stream = codexStream(
      (event) => {
        const row = traceForEvent(event, { persona: persona.name, candidate: label });
        if (row) input.trace.push(row);
      },
      { repoDir: sandbox.repoDir },
    );
    const result = await sandbox.exec(
      codexCommand({
        repoDir: sandbox.repoDir,
        promptFile: absolute(promptFile),
        lastMessageFile: absolute(lastMessageFile),
        outputSchemaFile: persona.outputSchema ? absolute(VERIFIER_SCHEMA) : null,
        resumeThreadId: input.resumeThreadId,
        extraWritableDirs: sandbox.writableRoots,
        apiKeyEnvVar: input.codexApiKeyEnvVar,
        bypassSandbox,
      }),
      {
        onLine: (line, channel) => {
          if (channel === "stdout") stream.push(line);
          else {
            stream.summary.noise.push(line);
            input.log?.(`[codex ${label}] ${line}`);
          }
        },
        timeoutMs: 60 * 60_000,
      },
    );
    return { exitCode: result.exitCode, summary: stream.summary };
  };

  let run = await attempt(false);
  let bypassedSandbox = false;
  if (looksLikeSandboxFailure(run.exitCode, run.summary)) {
    input.trace.push({
      kind: "status",
      status: "ok",
      title: `Candidate ${label}: Codex could not start its own sandbox, running with the box as the sandbox`,
      detail: {
        candidate: label,
        persona: persona.name,
        reason: run.summary.noise.slice(-5).join("\n"),
        flag: "--dangerously-bypass-approvals-and-sandbox",
      },
    });
    bypassedSandbox = true;
    run = await attempt(true);
  }
  await input.trace.drain();
  return { ...run, bypassedSandbox };
}

function mergeChanges(into: Map<string, FileUpdateChange>, changes: FileUpdateChange[]): void {
  for (const change of changes) {
    if (change.path.startsWith(".lantern/")) continue;
    const earlier = into.get(change.path);
    into.set(change.path, earlier?.kind === "add" && change.kind === "update" ? earlier : change);
  }
}

export async function runCandidate(plan: CandidatePlan, context: CandidateContext): Promise<CandidateOutcome> {
  const { ir, repo, store, strategy, personas } = context;
  const label = plan.label;
  const branch = branchName(ir, label);
  const trace = new TraceQueue(store);
  const id = await store.insertCandidate({
    label,
    strategy: strategy.name,
    capabilitySpecId: context.capabilitySpecId,
    branch,
  });

  const outcome: CandidateOutcome = {
    id,
    label,
    branch,
    status: "failed",
    sandbox: null,
    handle: null,
    verification: null,
    changedFiles: [],
    threadId: null,
    error: null,
  };

  trace.push({
    kind: "candidate",
    status: "running",
    title: `Candidate ${label} provisioning`,
    detail: { candidate: label, strategy: strategy.name, approach: plan.approach },
  });
  await store.updateCandidate(id, { status: "provisioning" });

  let sandbox: Sandbox | null = null;
  try {
    sandbox = await strategy.provision({ label, escalationId: context.escalationId, branch }, repo);
    outcome.sandbox = sandbox;
    outcome.handle = sandbox.handle;
    await store.updateCandidate(id, {
      status: "building",
      devboxId: sandbox.handle.devboxId ?? null,
      tunnelKey: sandbox.handle.tunnelKey ?? null,
      localPath: sandbox.handle.localPath ?? null,
      blueprintName: personas.capability_builder.sandboxOptions.blueprintName,
    });
    trace.push({
      kind: "candidate",
      status: "running",
      title: `Candidate ${label} building`,
      detail: { candidate: label, strategy: strategy.name, sandbox: sandbox.handle },
    });

    await sandbox.writeFile(".lantern/spec.json", JSON.stringify(ir, null, 2));
    await sandbox.writeFile(".lantern/trajectories.json", JSON.stringify(ir.evidence.trajectories, null, 2));
    await sandbox.writeFile(".lantern/acceptance.md", renderAcceptance(ir));
    const agentsMd = await sandbox.readFile("AGENTS.md").catch(() => null);

    const changed = new Map<string, FileUpdateChange>();
    let verifierMessage: string | null = null;
    for (const key of PERSONA_ORDER) {
      const persona = personas[key];
      await store.updateCandidate(id, { persona: key });
      trace.push({
        kind: "status",
        status: "running",
        title: `Candidate ${label}: ${persona.name} started`,
        detail: { candidate: label, persona: key, model: persona.model, resumes: persona.resumesThread },
      });
      const run = await runPersona({
        sandbox,
        persona,
        label,
        prompt: renderPrompt(persona, {
          ir,
          repo: { fullName: repo.fullName, defaultBranch: repo.defaultBranch },
          candidate: { label, approach: plan.approach },
          agentsMd,
        }),
        resumeThreadId: persona.resumesThread ? outcome.threadId : null,
        codexApiKeyEnvVar: context.codexApiKeyEnvVar,
        trace,
        log: context.log,
      });
      if (key === "capability_builder") outcome.threadId = run.summary.threadId;
      mergeChanges(changed, run.summary.changedFiles);
      outcome.changedFiles = [...changed.values()];
      await store.updateCandidate(id, {
        codexThreadId: outcome.threadId,
        codexExitCode: run.exitCode,
        changedFiles: outcome.changedFiles,
        devboxId: sandbox.handle.devboxId ?? null,
        tunnelKey: sandbox.handle.tunnelKey ?? null,
      });
      if (run.exitCode !== 0 || run.summary.failure) {
        throw new Error(
          `${persona.name} exited with ${run.exitCode}${run.summary.failure ? `: ${run.summary.failure}` : ""}`,
        );
      }
      if (key === "capability_verifier") verifierMessage = run.summary.lastMessage;
      trace.push({
        kind: "status",
        status: "ok",
        title: `Candidate ${label}: ${persona.name} finished`,
        detail: {
          candidate: label,
          persona: key,
          commands: run.summary.commands,
          files_changed: run.summary.changedFiles.length,
          usage: run.summary.usage,
          bypassed_sandbox: run.bypassedSandbox,
        },
      });
    }

    await store.updateCandidate(id, { status: "testing" });
    trace.push({
      kind: "status",
      status: "running",
      title: `Candidate ${label}: running the repository's tests`,
      detail: { candidate: label, command: "npm test -- --reporter=json" },
    });
    const tests = await sandbox.exec(`npm test -- --reporter=json --outputFile=${TEST_REPORT}`, {
      onLine: (line) => context.log?.(`[test ${label}] ${line}`),
      timeoutMs: 20 * 60_000,
    });
    const runnerText = await sandbox.readFile(TEST_REPORT).catch(() => tests.stdout || null);
    const verifierText = (await sandbox.readFile(VERIFIER_REPORT).catch(() => null)) ?? verifierMessage;
    const verification = scoreVerification(scenarioIds(ir), verifierText, runnerText);
    outcome.verification = verification;
    outcome.status = "ready";

    await store.updateCandidate(id, {
      status: "ready",
      scenariosPassed: verification.scenariosPassed,
      scenariosTotal: verification.scenariosTotal,
      failingScenarios: verification.failingScenarios,
      testReport: {
        verifier: verification.verifier,
        runner: verification.runner,
        problem: verification.problem,
        test_exit_code: tests.exitCode,
      },
      changedFiles: outcome.changedFiles,
      finishedAt: new Date().toISOString(),
    });
    trace.push({
      kind: "candidate",
      status: "ok",
      title: `Candidate ${label}: ${verification.scenariosPassed}/${verification.scenariosTotal}`,
      detail: {
        candidate: label,
        scenarios_passed: verification.scenariosPassed,
        scenarios_total: verification.scenariosTotal,
        failing: verification.failingScenarios,
        runner: verification.runner,
        files_changed: outcome.changedFiles.length,
        problem: verification.problem,
      },
    });
    await trace.drain();
    return outcome;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    outcome.error = message;
    outcome.status = "failed";
    trace.push({
      kind: "error",
      status: "failed",
      title: `Candidate ${label} failed`,
      detail: { candidate: label, message: message.slice(0, 4000) },
    });
    await store.updateCandidate(id, {
      status: "failed",
      error: message.slice(0, 2000),
      finishedAt: new Date().toISOString(),
    });
    if (sandbox) {
      await sandbox.teardown().catch((teardownError: Error) => context.log?.(`teardown failed: ${teardownError.message}`));
      await store.updateCandidate(id, { tornDownAt: new Date().toISOString() });
      outcome.sandbox = null;
    }
    await trace.drain();
    return outcome;
  }
}
