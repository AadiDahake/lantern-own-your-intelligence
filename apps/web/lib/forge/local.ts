/**
 * The local strategy: the same persona steps in a git worktree on this machine.
 *
 * One clone of the target repository lives in a cache directory under the OS temp dir. Each
 * candidate gets its own worktree of that clone, its own branch, and the clone's dependency tree
 * through a symlink, so two candidates build in parallel without two installs. Codex is the
 * machine's own `codex`, which runs on the saved login when no key is set. The preview is
 * `next start` on a free port. The branch is pushed to GitHub with the configured token and the
 * pull request is opened through the REST API. Same trace, same rows, same pull request as a
 * devbox; only the box is this laptop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { GithubClient } from "../github";
import { isServing, waitForHttp } from "./preview";
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

export type LocalStrategyOptions = {
  /** Where the clone and the worktrees live. Defaults to `<tmpdir>/lantern-forge`. */
  cacheDir?: string | null;
  /** The model key handed to Codex as `LANTERN_OPENAI_KEY`. Null runs on the saved login. */
  codexApiKey?: string | null;
  /** Identity for the candidate's commit. */
  gitIdentity?: { name: string; email: string };
  /** Where the strategy's own progress lines go. */
  log?: (line: string) => void;
};

const KEY_ENV = "LANTERN_OPENAI_KEY";
const TOKEN_ENV = "LANTERN_GIT_TOKEN";
const DEFAULT_IDENTITY = { name: "Lantern", email: "lantern@users.noreply.github.com" };

/** The token reaches git through the environment, never through the argument list. */
const CREDENTIAL_HELPER = `!f() { echo "username=x-access-token"; echo "password=$${TOKEN_ENV}"; }; f`;

/** Preview servers this process started, by worktree path, so a later request can stop them. */
const previewServers = new Map<string, ChildProcess>();

function splitLines(onLine: (line: string) => void): { push(chunk: Buffer): void; flush(): void } {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        onLine(buffer.slice(0, index).replace(/\r$/, ""));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    },
    flush() {
      if (buffer !== "") onLine(buffer);
      buffer = "";
    },
  };
}

/**
 * The environment a child inherits. The launcher's own loader settings (`tsx --tsconfig` exports
 * `TSX_TSCONFIG_PATH`, a `NODE_OPTIONS` that imports tsx) would be read by every `tsx` and `node`
 * the target repository runs, and point them at files that do not exist there.
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TSX_TSCONFIG_PATH;
  if (env.NODE_OPTIONS && /tsx/.test(env.NODE_OPTIONS)) delete env.NODE_OPTIONS;
  return { ...env, ...extra };
}

/** Runs one program with arguments (no shell) and collects its output. */
export function run(
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; onLine?: ExecOptions["onLine"]; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: childEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const out = splitLines((line) => options.onLine?.(line, "stdout"));
    const err = splitLines((line) => options.onLine?.(line, "stderr"));
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      err.push(chunk);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          stderr += `\n[lantern] killed after ${options.timeoutMs} ms`;
        }, options.timeoutMs)
      : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      out.flush();
      err.flush();
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const result = await run("git", args, { cwd, env });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.slice(0, 2).join(" ")} failed in ${cwd}: ${result.stderr.trim().slice(0, 500)}`);
  }
  return result.stdout.trim();
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

function localUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class LocalStrategy implements SandboxStrategy {
  readonly name = "local" as const;
  private readonly cloneLocks = new Map<string, Promise<string>>();

  constructor(private readonly options: LocalStrategyOptions = {}) {}

  cacheRoot(): string {
    // A runtime location on the machine that runs the app, never a bundled asset, so the build's
    // file tracer has nothing to follow here.
    return resolve(/*turbopackIgnore: true*/ this.options.cacheDir ?? join(tmpdir(), "lantern-forge"));
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  private gitEnv(repo: TargetRepo): Record<string, string> {
    return repo.token ? { [TOKEN_ENV]: repo.token } : {};
  }

  private cloneSource(repo: TargetRepo): string {
    return repo.source ?? `https://github.com/${repo.fullName}.git`;
  }

  /** One clone per repository, fetched and installed once per run however many candidates ask. */
  private ensureClone(repo: TargetRepo): Promise<string> {
    const cloneDir = join(this.cacheRoot(), "repos", `${repo.owner}__${repo.name}`);
    const pending = this.cloneLocks.get(cloneDir);
    if (pending) return pending;
    const task = this.prepareClone(cloneDir, repo).finally(() => this.cloneLocks.delete(cloneDir));
    this.cloneLocks.set(cloneDir, task);
    return task;
  }

  private async prepareClone(cloneDir: string, repo: TargetRepo): Promise<string> {
    const env = this.gitEnv(repo);
    const auth = repo.token ? ["-c", `credential.helper=${CREDENTIAL_HELPER}`] : [];
    if (!(await exists(join(cloneDir, ".git")))) {
      await mkdir(dirname(cloneDir), { recursive: true });
      this.log(`Cloning ${repo.fullName} into ${cloneDir}`);
      await git(dirname(cloneDir), [...auth, "clone", "--quiet", this.cloneSource(repo), cloneDir], env);
    } else {
      this.log(`Fetching ${repo.fullName}`);
      await git(cloneDir, [...auth, "fetch", "--quiet", "--prune", "origin"], env);
    }
    await git(cloneDir, ["worktree", "prune"]);
    // The clone's own tree sits on the base so the install below reads the right lockfile.
    await git(cloneDir, ["checkout", "--quiet", "--detach", `origin/${repo.defaultBranch}`]);

    const lock = join(cloneDir, "package-lock.json");
    const installed = join(cloneDir, "node_modules", ".package-lock.json");
    const stale =
      !(await exists(installed)) ||
      (await exists(lock)) && (await stat(lock)).mtimeMs > (await stat(installed)).mtimeMs;
    if (stale) {
      this.log(`Installing dependencies in ${cloneDir}`);
      const result = await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: cloneDir });
      if (result.exitCode !== 0) throw new Error(`npm ci failed: ${result.stderr.slice(-800)}`);
    }
    return cloneDir;
  }

  async previewPort(): Promise<number> {
    return freePort();
  }

  async provision(candidate: CandidateSeed, repo: TargetRepo): Promise<Sandbox> {
    const cloneDir = await this.ensureClone(repo);
    const dir = join(
      this.cacheRoot(),
      "candidates",
      `${candidate.escalationId.slice(0, 8)}-${candidate.label.toLowerCase()}`,
    );
    // A worktree left by a crashed run is not evidence; start clean.
    if (await exists(dir)) {
      await git(cloneDir, ["worktree", "remove", "--force", dir]).catch(() => rm(dir, { recursive: true, force: true }));
    }
    await git(cloneDir, ["branch", "-D", candidate.branch]).catch(() => undefined);
    await mkdir(dirname(dir), { recursive: true });
    this.log(`Candidate ${candidate.label}: worktree at ${dir}`);
    await git(cloneDir, ["worktree", "add", "--quiet", "--detach", dir, `origin/${repo.defaultBranch}`]);
    await git(dir, ["checkout", "--quiet", "-b", candidate.branch]);

    const modules = join(cloneDir, "node_modules");
    if (await exists(modules)) await symlink(modules, join(dir, "node_modules"), "dir");

    return new LocalSandbox(
      { strategy: "local", localPath: dir, previewPort: null, devboxId: null, tunnelKey: null },
      dir,
      cloneDir,
      repo,
      candidate,
      this.options,
    );
  }

  async previewUrl(handle: SandboxHandle, port: number): Promise<string | null> {
    const chosen = handle.previewPort ?? port;
    const url = localUrl(chosen);
    return (await isServing(url)) ? url : null;
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    if (!handle.localPath) return;
    stopPreview(handle.localPath);
    if (!(await exists(handle.localPath))) return;
    const common = await git(handle.localPath, ["rev-parse", "--git-common-dir"]).catch(() => null);
    const cloneDir = common ? resolve(handle.localPath, common, "..") : null;
    if (cloneDir) {
      await git(cloneDir, ["worktree", "remove", "--force", handle.localPath]).catch(() => undefined);
    }
    await rm(handle.localPath, { recursive: true, force: true });
  }
}

function stopPreview(dir: string): void {
  const child = previewServers.get(dir);
  if (!child) return;
  previewServers.delete(dir);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5_000).unref();
}

class LocalSandbox implements Sandbox {
  readonly writableRoots: string[];
  private tornDown = false;

  constructor(
    readonly handle: SandboxHandle,
    readonly repoDir: string,
    private readonly cloneDir: string,
    private readonly repo: TargetRepo,
    private readonly candidate: CandidateSeed,
    private readonly options: LocalStrategyOptions,
  ) {
    // Codex may only write inside the checkout. The dependency tree lives beside it, and a test
    // runner writes its cache there, so that one directory is opened as well.
    this.writableRoots = [join(cloneDir, "node_modules")];
  }

  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : join(this.repoDir, path);
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const env: Record<string, string> = { ...(options.env ?? {}) };
    if (this.options.codexApiKey) env[KEY_ENV] = this.options.codexApiKey;
    return run("bash", ["-c", command], {
      cwd: this.repoDir,
      env,
      onLine: options.onLine,
      timeoutMs: options.timeoutMs,
    });
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const target = this.resolvePath(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolvePath(path), "utf8");
  }

  async serve(port: number): Promise<string> {
    const build = await this.exec("npm run build", {
      onLine: (line) => this.options.log?.(`[build ${this.candidate.label}] ${line}`),
      timeoutMs: 15 * 60_000,
    });
    if (build.exitCode !== 0) {
      throw new Error(`The build failed for candidate ${this.candidate.label}: ${build.stderr.slice(-800)}`);
    }
    stopPreview(this.repoDir);
    const child = spawn("npm", ["run", "start", "--", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: this.repoDir,
      env: childEnv({ PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => this.options.log?.(`[preview ${this.candidate.label}] ${chunk.toString("utf8").trimEnd()}`));
    child.stderr?.on("data", (chunk: Buffer) => this.options.log?.(`[preview ${this.candidate.label}] ${chunk.toString("utf8").trimEnd()}`));
    child.on("exit", () => {
      if (previewServers.get(this.repoDir) === child) previewServers.delete(this.repoDir);
    });
    previewServers.set(this.repoDir, child);
    const url = localUrl(port);
    await waitForHttp(url);
    this.handle.previewPort = port;
    return url;
  }

  async pushBranch(branch: string, message: string): Promise<{ sha: string }> {
    const identity = this.options.gitIdentity ?? DEFAULT_IDENTITY;
    const who = ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`];
    // The specification files are Lantern's; they never travel with the change. The dependency
    // tree is a symlink here, which a `node_modules/` ignore pattern does not cover.
    await git(this.repoDir, ["add", "-A", "--", ".", ":!.lantern", ":!node_modules"]);
    const staged = await run("git", ["diff", "--cached", "--quiet"], { cwd: this.repoDir });
    if (staged.exitCode !== 0) await git(this.repoDir, [...who, "commit", "--quiet", "-m", message]);
    const sha = await git(this.repoDir, ["rev-parse", "HEAD"]);
    if (!this.repo.token) throw new Error("A GitHub token is required to push the candidate branch.");
    // Always GitHub, even when the clone came from a local path: a development source is never a
    // push target.
    await git(
      this.repoDir,
      ["-c", `credential.helper=${CREDENTIAL_HELPER}`, "push", "--quiet", "--force-with-lease", `https://github.com/${this.repo.fullName}.git`, `HEAD:refs/heads/${branch}`],
      { [TOKEN_ENV]: this.repo.token },
    );
    return { sha };
  }

  async openDraftPr(input: DraftPrInput): Promise<DraftPr> {
    if (!this.repo.token) throw new Error("A GitHub token is required to open the pull request.");
    const pull = await new GithubClient(this.repo.token).openDraftPullRequest(this.repo.fullName, {
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.base,
    });
    return { url: pull.url, number: pull.number, nodeId: pull.nodeId };
  }

  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    stopPreview(this.repoDir);
    await git(this.cloneDir, ["worktree", "remove", "--force", this.repoDir]).catch(() => undefined);
    await rm(this.repoDir, { recursive: true, force: true });
    await git(this.cloneDir, ["branch", "-D", this.candidate.branch]).catch(() => undefined);
    if (existsSync(this.repoDir)) await rm(this.repoDir, { recursive: true, force: true });
  }
}
