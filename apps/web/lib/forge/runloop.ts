/**
 * The Runloop strategy: one devbox per candidate.
 *
 * The box is created with a code mount of the target repository (the token makes a private repo
 * reachable and sets up `gh`), the Codex CLI installed by a launch command unless a blueprint
 * already carries it, a public tunnel for the preview, a keep-alive so it cannot outlive the demo
 * by more than an hour, and a metadata tag so the sweeper can find what a crash left behind.
 * Every path that creates a box also shuts it down.
 */
import { RunloopSDK } from "@runloop/api-client";
import type { Devbox } from "@runloop/api-client/sdk";
import { CODEX_CLI_VERSION } from "./codex";
import { isServing, tunnelUrl, waitForHttp } from "./preview";
import { shellQuote } from "./shell";
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
} from "./strategy";

export type RunloopStrategyOptions = {
  apiKey: string;
  /** The model key, injected into the box as `LANTERN_OPENAI_KEY` and read by Codex only. */
  openaiApiKey: string;
  blueprintName?: string | null;
  /** How long a box may live with nobody talking to it. Bounded so a leak costs an hour, not a week. */
  keepAliveSeconds?: number;
  log?: (line: string) => void;
};

export const KEY_ENV = "LANTERN_OPENAI_KEY";
export const CANDIDATE_TAG = "lantern_candidate";
export const ESCALATION_TAG = "lantern_escalation";
export const PREVIEW_PORT = 3000;
const DEFAULT_KEEP_ALIVE_SECONDS = 3600;
const PROVISION_TIMEOUT_MS = 15 * 60_000;
const EXEC_TIMEOUT_MS = 60 * 60_000;
const HOME = "/home/user";

/** `gh` is authenticated by the code mount; git needs the same token for a push. */
const CREDENTIAL_HELPER = `!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f`;

export class RunloopStrategy implements SandboxStrategy {
  readonly name = "runloop" as const;
  private readonly sdk: RunloopSDK;

  constructor(private readonly options: RunloopStrategyOptions) {
    this.sdk = new RunloopSDK({ bearerToken: options.apiKey });
  }

  async previewPort(): Promise<number> {
    return PREVIEW_PORT;
  }

  async provision(candidate: CandidateSeed, repo: TargetRepo): Promise<Sandbox> {
    const blueprint = this.options.blueprintName ?? null;
    this.options.log?.(`Candidate ${candidate.label}: creating a LARGE devbox${blueprint ? ` from ${blueprint}` : ""}`);
    const devbox = await this.sdk.devbox.create(
      {
        name: `lantern-${candidate.label.toLowerCase()}-${candidate.escalationId.slice(0, 8)}`,
        metadata: { [CANDIDATE_TAG]: candidate.label, [ESCALATION_TAG]: candidate.escalationId },
        environment_variables: { [KEY_ENV]: this.options.openaiApiKey },
        mounts: [
          {
            type: "code_mount",
            repo_owner: repo.owner,
            repo_name: repo.name,
            token: repo.token,
            git_ref: repo.defaultBranch,
            install_command: "npm ci --no-audit --no-fund",
          },
        ],
        launch_parameters: {
          resource_size_request: "LARGE",
          keep_alive_time_seconds: this.options.keepAliveSeconds ?? DEFAULT_KEEP_ALIVE_SECONDS,
          available_ports: [PREVIEW_PORT],
          // A blueprint carries Codex already; the starter image gets it on launch.
          launch_commands: blueprint ? [] : [`npm i -g @openai/codex@${CODEX_CLI_VERSION}`],
        },
        tunnel: { auth_mode: "open" },
        ...(blueprint ? { blueprint_name: blueprint } : {}),
      },
      { polling: { timeoutMs: PROVISION_TIMEOUT_MS } },
    );
    try {
      const tunnel = await devbox.getTunnel();
      const repoDir = `${HOME}/${repo.name}`;
      return new RunloopSandbox(
        {
          strategy: "runloop",
          devboxId: devbox.id,
          tunnelKey: tunnel?.tunnel_key ?? null,
          localPath: null,
          previewPort: null,
        },
        devbox,
        repoDir,
        repo,
        candidate,
        this.options,
      );
    } catch (error) {
      // The box exists; nothing else may fail without it going away.
      await devbox.shutdown().catch(() => undefined);
      throw error;
    }
  }

  async previewUrl(handle: SandboxHandle, port: number): Promise<string | null> {
    if (!handle.devboxId || !handle.tunnelKey) return null;
    const info = await this.sdk.devbox.fromId(handle.devboxId).getInfo().catch(() => null);
    if (!info || info.status !== "running") return null;
    const url = tunnelUrl(handle.previewPort ?? port, handle.tunnelKey);
    return (await isServing(url)) ? url : null;
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    if (!handle.devboxId) return;
    await shutdownQuietly(this.sdk.devbox.fromId(handle.devboxId));
  }

  /**
   * Shuts down every box this engine tagged that is still alive. For the orphans a crash or a
   * killed process left behind. Returns what it shut down.
   */
  async sweep(): Promise<{ id: string; name: string | null; candidate: string; status: string }[]> {
    const swept: { id: string; name: string | null; candidate: string; status: string }[] = [];
    const statuses = ["running", "initializing", "provisioning", "queued", "scheduled", "suspended", "resuming"] as const;
    for (const status of statuses) {
      const boxes = await this.sdk.devbox.list({ status });
      for (const box of boxes) {
        const info = await box.getInfo().catch(() => null);
        const candidate = info?.metadata?.[CANDIDATE_TAG];
        if (!info || !candidate) continue;
        await shutdownQuietly(box);
        swept.push({ id: box.id, name: info.name ?? null, candidate, status: info.status });
      }
    }
    return swept;
  }
}

async function shutdownQuietly(devbox: Devbox): Promise<void> {
  try {
    await devbox.shutdown();
  } catch (error) {
    const message = (error as Error).message ?? "";
    // A box that is already gone is the outcome we wanted.
    if (!/shutdown|not found|404/i.test(message)) throw error;
  }
}

/** A box the Runloop API drives directly. The Reflex strategy borrows it for an agent's devbox. */
export class RunloopSandbox implements Sandbox {
  readonly writableRoots: string[] = [];
  private tornDown = false;

  constructor(
    readonly handle: SandboxHandle,
    private readonly devbox: Devbox,
    readonly repoDir: string,
    private readonly repo: TargetRepo,
    private readonly candidate: CandidateSeed,
    private readonly options: Pick<RunloopStrategyOptions, "log">,
  ) {}

  private resolvePath(path: string): string {
    return path.startsWith("/") ? path : `${this.repoDir}/${path}`;
  }

  /** Every exec is a fresh shell, so every command starts in the repository. */
  private inRepo(command: string): string {
    return `cd ${shellQuote(this.repoDir)} && ${command}`;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const exported = Object.entries(options.env ?? {})
      .map(([key, value]) => `export ${key}=${shellQuote(value)};`)
      .join(" ");
    const result = await this.devbox.cmd.exec(
      this.inRepo(`${exported} ${command}`.trim()),
      {
        stdout: (line) => options.onLine?.(line, "stdout"),
        stderr: (line) => options.onLine?.(line, "stderr"),
      },
      { polling: { timeoutMs: options.timeoutMs ?? EXEC_TIMEOUT_MS, maxAttempts: Number.MAX_SAFE_INTEGER } },
    );
    return { exitCode: result.exitCode ?? -1, stdout: await result.stdout(), stderr: await result.stderr() };
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const target = this.resolvePath(path);
    const directory = target.slice(0, target.lastIndexOf("/"));
    await this.devbox.cmd.exec(`mkdir -p ${shellQuote(directory)}`);
    await this.devbox.file.write({ file_path: target, contents });
  }

  async readFile(path: string): Promise<string> {
    return this.devbox.file.read({ file_path: this.resolvePath(path) });
  }

  async serve(port: number): Promise<string> {
    const build = await this.exec("npm run build", {
      onLine: (line) => this.options.log?.(`[build ${this.candidate.label}] ${line}`),
      timeoutMs: 20 * 60_000,
    });
    if (build.exitCode !== 0) {
      throw new Error(`The build failed for candidate ${this.candidate.label}: ${build.stderr.slice(-800)}`);
    }
    // The tunnel only reaches a service bound to 0.0.0.0; Next binds localhost by default.
    await this.devbox.cmd.execAsync(
      this.inRepo(
        `HOSTNAME=0.0.0.0 PORT=${port} npm run start -- -p ${port} -H 0.0.0.0 > /tmp/lantern-preview.log 2>&1`,
      ),
    );
    if (!this.handle.tunnelKey) throw new Error("The devbox has no tunnel, so there is no preview URL.");
    const url = tunnelUrl(port, this.handle.tunnelKey);
    await waitForHttp(url);
    this.handle.previewPort = port;
    return url;
  }

  async pushBranch(branch: string, message: string): Promise<{ sha: string }> {
    const identity = { name: "Lantern", email: "lantern@users.noreply.github.com" };
    const commit =
      `git checkout -q -B ${shellQuote(branch)} && ` +
      `git add -A -- . ':!.lantern' ':!node_modules' && ` +
      `(git diff --cached --quiet || git -c user.name=${shellQuote(identity.name)} -c user.email=${shellQuote(identity.email)} commit -q -m ${shellQuote(message)}) && ` +
      `git -c credential.helper=${shellQuote(CREDENTIAL_HELPER)} push -q --force-with-lease -u origin ${shellQuote(branch)} && ` +
      `git rev-parse HEAD`;
    const result = await this.exec(commit, { timeoutMs: 5 * 60_000 });
    if (result.exitCode !== 0) throw new Error(`The push failed: ${result.stderr.slice(-800)}`);
    const sha = result.stdout.trim().split(/\s+/).pop() ?? "";
    return { sha };
  }

  async openDraftPr(input: DraftPrInput): Promise<DraftPr> {
    await this.writeFile(".lantern/pr-body.md", input.body);
    const command =
      `gh pr create --draft --title ${shellQuote(input.title)} --body-file .lantern/pr-body.md ` +
      `--head ${shellQuote(input.branch)} --base ${shellQuote(input.base)} --repo ${shellQuote(this.repo.fullName)}`;
    const result = await this.exec(command, { timeoutMs: 2 * 60_000 });
    if (result.exitCode !== 0) throw new Error(`gh pr create failed: ${result.stderr.slice(-800)}`);
    const url = result.stdout.trim().split(/\s+/).find((word) => /\/pull\/\d+$/.test(word));
    if (!url) throw new Error(`gh pr create printed no pull request URL: ${result.stdout.slice(-300)}`);
    const number = Number(url.split("/").pop());
    return { url, number, nodeId: null };
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    await shutdownQuietly(this.devbox);
  }
}
