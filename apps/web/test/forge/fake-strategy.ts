/**
 * A sandbox strategy for the tests: records every call and replays recorded Codex JSONL for each
 * persona, so the engine runs end to end with no Runloop, no Codex and no database.
 *
 * Candidate A replays a run that fails three scenarios; candidate B one that passes all 21. The
 * fixtures are what `codex exec --json` prints, line for line, and the verifier's final message is
 * the JSON report its output schema constrains it to.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CandidateSeed,
  DraftPr,
  DraftPrInput,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxHandle,
  SandboxStrategy,
  TargetRepo,
} from "@/lib/forge/strategy";

const FIXTURES = join(__dirname, "..", "fixtures", "forge");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export type FakeBehaviour = {
  /** Labels whose provisioning throws. */
  failProvision?: string[];
  /** Labels whose Capability Builder exits non-zero. */
  failBuilder?: string[];
  /** Labels whose first Codex run dies with a sandbox error, to exercise the Landlock fallback. */
  sandboxFailsOnce?: string[];
  /** Labels whose build (`npm run build`) fails. */
  failBuild?: string[];
  /** Files present in the checkout before any persona runs, e.g. an AGENTS.md. */
  seedFiles?: Record<string, string>;
};

export type Call = { sandbox: string; method: string; args: unknown[] };

export class FakeSandbox implements Sandbox {
  readonly handle: SandboxHandle;
  readonly repoDir: string;
  readonly writableRoots: string[] = [];
  readonly files = new Map<string, string>();
  readonly commands: string[] = [];
  tornDown = false;
  served: number | null = null;
  pushed: { branch: string; message: string } | null = null;
  pr: DraftPrInput | null = null;
  private sandboxFailed = false;

  constructor(
    readonly label: string,
    private readonly behaviour: FakeBehaviour,
    private readonly calls: Call[],
  ) {
    this.handle = {
      strategy: "fake",
      devboxId: `dbx_fake_${label.toLowerCase()}`,
      tunnelKey: `tk${label.toLowerCase()}`,
      localPath: null,
      previewPort: null,
    };
    this.repoDir = `/home/user/novaair-${label.toLowerCase()}`;
    for (const [path, contents] of Object.entries(behaviour.seedFiles ?? {})) this.files.set(path, contents);
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ sandbox: this.label, method, args });
  }

  private relative(path: string): string {
    return path.startsWith(this.repoDir + "/") ? path.slice(this.repoDir.length + 1) : path;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.record("exec", command);
    this.commands.push(command);
    const emit = (line: string, stream: "stdout" | "stderr" = "stdout"): void => options.onLine?.(line, stream);

    if (command.includes("codex exec")) {
      if (this.behaviour.sandboxFailsOnce?.includes(this.label) && !this.sandboxFailed && !command.includes("--dangerously-bypass")) {
        this.sandboxFailed = true;
        emit("ERROR: Landlock sandbox unavailable: failed to create sandbox (EPERM)", "stderr");
        return { exitCode: 1, stdout: "", stderr: "Landlock sandbox unavailable" };
      }
      const persona = /prompt-([a-z_]+)\.md/.exec(command)?.[1] ?? "capability_builder";
      const part = persona === "capability_builder" ? "builder" : persona === "ux_builder" ? "ux" : "verifier";
      const lines = fixture(`candidate-${this.label.toLowerCase()}.${part}.jsonl`).trim().split("\n");
      emit(`OpenAI Codex v0.151.0`, "stderr");
      for (const line of lines) emit(line);
      if (part === "builder" && this.behaviour.failBuilder?.includes(this.label)) {
        emit(JSON.stringify({ type: "error", message: "the model provider closed the stream" }));
        return { exitCode: 1, stdout: lines.join("\n"), stderr: "" };
      }
      if (part === "verifier") {
        this.files.set(".lantern/verifier-report.json", fixture(`candidate-${this.label.toLowerCase()}.verifier-report.json`));
      }
      const last = /-o (\S+)/.exec(command)?.[1];
      if (last && part !== "verifier") this.files.set(this.relative(last), "summary");
      return { exitCode: 0, stdout: lines.join("\n"), stderr: "" };
    }
    if (command.startsWith("npm test")) {
      const report = fixture(`candidate-${this.label.toLowerCase()}.vitest.json`);
      this.files.set(".lantern/test-report.json", report);
      const failed = (JSON.parse(report) as { numFailedTests: number }).numFailedTests;
      emit(failed ? ` Tests  ${failed} failed` : " Tests  59 passed (59)");
      return { exitCode: failed ? 1 : 0, stdout: "", stderr: "" };
    }
    if (command.startsWith("npm run build")) {
      if (this.behaviour.failBuild?.includes(this.label)) return { exitCode: 1, stdout: "", stderr: "Type error in components/seats/FindSeatsTogether.tsx" };
      emit(" ✓ Compiled successfully");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.record("writeFile", path);
    this.files.set(this.relative(path), contents);
  }

  async readFile(path: string): Promise<string> {
    const contents = this.files.get(this.relative(path));
    if (contents === undefined) throw new Error(`ENOENT: ${path}`);
    return contents;
  }

  async serve(port: number): Promise<string> {
    this.record("serve", port);
    const build = await this.exec("npm run build");
    if (build.exitCode !== 0) throw new Error(`The build failed for candidate ${this.label}: ${build.stderr}`);
    this.served = port;
    this.handle.previewPort = port;
    return `https://${port}-${this.handle.tunnelKey}.tunnel.runloop.ai`;
  }

  async pushBranch(branch: string, message: string): Promise<{ sha: string }> {
    this.record("pushBranch", branch, message);
    this.pushed = { branch, message };
    return { sha: "4f2a9c0e1b7d6a5c3e8f9a0b1c2d3e4f5a6b7c8d" };
  }

  async openDraftPr(input: DraftPrInput): Promise<DraftPr> {
    this.record("openDraftPr", input);
    this.pr = input;
    return { url: "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/182", number: 182, nodeId: "PR_kwDOfake182" };
  }

  async teardown(): Promise<void> {
    this.record("teardown");
    this.tornDown = true;
  }
}

export class FakeStrategy implements SandboxStrategy {
  readonly name = "fake" as const;
  readonly calls: Call[] = [];
  readonly sandboxes = new Map<string, FakeSandbox>();
  readonly tornDownHandles: SandboxHandle[] = [];

  constructor(private readonly behaviour: FakeBehaviour = {}) {}

  async previewPort(): Promise<number> {
    return 3000;
  }

  async provision(candidate: CandidateSeed, repo: TargetRepo): Promise<Sandbox> {
    this.calls.push({ sandbox: candidate.label, method: "provision", args: [candidate, repo.fullName] });
    if (this.behaviour.failProvision?.includes(candidate.label)) {
      throw new Error(`Runloop refused a third devbox (trial limit) for candidate ${candidate.label}`);
    }
    const sandbox = new FakeSandbox(candidate.label, this.behaviour, this.calls);
    this.sandboxes.set(candidate.label, sandbox);
    return sandbox;
  }

  async previewUrl(handle: SandboxHandle, port: number): Promise<string | null> {
    const sandbox = [...this.sandboxes.values()].find((entry) => entry.handle.devboxId === handle.devboxId);
    if (!sandbox || sandbox.tornDown || sandbox.served === null) return null;
    return `https://${handle.previewPort ?? port}-${handle.tunnelKey}.tunnel.runloop.ai`;
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    this.tornDownHandles.push(handle);
    const sandbox = [...this.sandboxes.values()].find((entry) => entry.handle.devboxId === handle.devboxId);
    if (sandbox) sandbox.tornDown = true;
  }
}

/** A repository the tests target. The token is a placeholder, never a real credential. */
export const REPO: TargetRepo = {
  fullName: "AadiDahake/novaair-own-your-intelligence",
  owner: "AadiDahake",
  name: "novaair",
  defaultBranch: "main",
  token: "test-token",
};
