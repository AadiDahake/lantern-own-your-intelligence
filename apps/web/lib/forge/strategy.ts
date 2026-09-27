/**
 * The seam between the engine and wherever a candidate is built.
 *
 * The engine only knows this interface. `runloop.ts` implements it with devboxes, `local.ts` with
 * a git worktree on the machine that runs the app, and the tests with a fake that replays
 * recorded Codex output. Everything else about a run is identical across the three.
 */

import type { CodexRunSummary } from "./codex";
import type { Persona } from "./personas";
import type { ForgeTrace } from "./store";

export type StrategyName = "reflex" | "runloop" | "local" | "fake";

/**
 * What a candidate row stores about its sandbox. Enough to find the box again from another
 * process (the preview route, the approval), never a URL: a preview URL is only valid while the
 * box runs and is rebuilt from these parts on every read.
 */
export type SandboxHandle = {
  strategy: StrategyName;
  /** The Reflex agent currently holding the box, when a Reflex persona is at work. */
  agentId?: string | null;
  devboxId?: string | null;
  tunnelKey?: string | null;
  localPath?: string | null;
  previewPort?: number | null;
};

export type TargetRepo = {
  /** `owner/name`. */
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  /** The GitHub token the sandbox clones and pushes with. Null only for a public repo, read-only. */
  token: string | null;
  /**
   * Where to clone from when it is not GitHub: a local path or a URL. Used by the local strategy
   * for development runs against a checkout that is not pushed yet. Pushes still go to GitHub.
   */
  source?: string | null;
};

export type ExecOptions = {
  /** Every line of output as it arrives, with the stream it came from. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Extra variables for this one command. */
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

export type CandidateSeed = { label: string; escalationId: string; branch: string };

export type DraftPrInput = { branch: string; base: string; title: string; body: string };

export type DraftPr = { url: string; number: number; nodeId: string | null };

export type PersonaRunRequest = {
  persona: Persona;
  /** The rendered prompt: the persona's system prompt and the run's context. */
  prompt: string;
  /** Continue the thread an earlier persona left, when the sandbox supports it. */
  resumeThreadId: string | null;
  /** The environment variable holding the model key inside the sandbox, or null for a saved login. */
  apiKeyEnvVar: string | null;
  /** Trace rows, in order, as the persona works. */
  onTrace: (row: ForgeTrace) => void;
  log?: (line: string) => void;
};

export type PersonaRunResult = {
  exitCode: number;
  summary: CodexRunSummary;
  /** True when Codex ran without its own sandbox because the box is the sandbox. */
  bypassedSandbox: boolean;
};

/** One provisioned sandbox holding one checkout of the target repository. */
export interface Sandbox {
  readonly handle: SandboxHandle;
  /** The repository root inside the sandbox. Absolute. */
  readonly repoDir: string;
  /** Directories outside the checkout that Codex may still write, such as a shared dependency tree. */
  readonly writableRoots: string[];
  /** Runs one shell line in the sandbox. Never throws on a non-zero exit; the caller decides. */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  /**
   * Runs one persona the sandbox's own way. A Reflex sandbox launches the persona by id and
   * streams its events; a sandbox without this runs `codex exec` through `exec` instead.
   */
  runPersona?(request: PersonaRunRequest): Promise<PersonaRunResult>;
  /** `path` is relative to the repository root unless absolute. Parent directories are created. */
  writeFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Builds the app, serves it on `port`, and returns a URL that answered a health check. */
  serve(port: number): Promise<string>;
  /** Commits every change except `.lantern/` and pushes the branch to GitHub. */
  pushBranch(branch: string, message: string): Promise<{ sha: string }>;
  openDraftPr(input: DraftPrInput): Promise<DraftPr>;
  /** Stops whatever is running and releases the box. Safe to call twice. */
  teardown(): Promise<void>;
}

export interface SandboxStrategy {
  readonly name: StrategyName;
  provision(candidate: CandidateSeed, repo: TargetRepo): Promise<Sandbox>;
  /** The port the winner's preview serves on. Fixed in a devbox, a free one on a laptop. */
  previewPort(): Promise<number>;
  /** The live preview URL for a stored handle, or null when the box is gone or not answering. */
  previewUrl(handle: SandboxHandle, port: number): Promise<string | null>;
  /** Tears down a box from its stored handle, for a process that did not provision it. */
  teardown(handle: SandboxHandle): Promise<void>;
}
