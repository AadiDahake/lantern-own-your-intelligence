/**
 * The `codex exec` invocation, and the parser that turns its JSONL stream into trace events.
 *
 * One persona is one `codex exec` run. The prompt is read from a file on stdin, so neither the
 * argument list nor any log line carries it. The model key reaches only the Codex process, as
 * `CODEX_API_KEY` set on that one command, never as an environment the tests or the build see.
 */
import type { TraceInput } from "../trace";
import { asThreadEvent, type ThreadEvent, type FileUpdateChange, type Usage } from "./codex-events";
import { shellJoin, shellQuote, tail, truncate } from "./shell";

/** The Codex CLI version the engine installs in a devbox and the model every persona runs on. */
export const CODEX_CLI_VERSION = "0.151.0";
export const CODEX_MODEL = "gpt-5.6-sol";

export type CodexInvocation = {
  /** The repository root inside the sandbox. Codex works here and may write only here. */
  repoDir: string;
  /** The prompt, as a file inside the sandbox. Read on stdin. */
  promptFile: string;
  /** Where the agent's final message is written (`-o`). */
  lastMessageFile: string;
  /** JSON Schema for the final message (`--output-schema`). */
  outputSchemaFile?: string | null;
  /** Continue an earlier persona's thread instead of starting a new one. */
  resumeThreadId?: string | null;
  /** Extra directories Codex may write, for a shared dependency tree outside the checkout. */
  extraWritableDirs?: string[];
  /**
   * Name of the environment variable holding the model key. It is expanded by the sandbox's
   * shell, so the key itself never appears in the command. Null runs on the saved Codex login.
   */
  apiKeyEnvVar?: string | null;
  /**
   * Skip Codex's own sandbox. Only for a box that is itself the sandbox, and only after
   * `workspace-write` failed to start (Landlock is not available in every container).
   */
  bypassSandbox?: boolean;
};

/** The words after `codex`, as one argv. */
export function codexArgs(invocation: CodexInvocation): string[] {
  const args = ["exec"];
  if (invocation.resumeThreadId) args.push("resume", invocation.resumeThreadId);

  if (invocation.bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (invocation.resumeThreadId) {
    // `resume` takes no `--sandbox` flag; the same policy goes in through config overrides.
    args.push("-c", 'sandbox_mode="workspace-write"');
    args.push("-c", "sandbox_workspace_write.network_access=true");
  } else {
    args.push("--sandbox", "workspace-write");
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }

  const writable = invocation.extraWritableDirs ?? [];
  if (writable.length > 0 && !invocation.bypassSandbox) {
    args.push("-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(writable)}`);
  }

  args.push("--skip-git-repo-check", "--json", "-m", CODEX_MODEL);
  if (!invocation.resumeThreadId) args.push("-C", invocation.repoDir);
  args.push("-o", invocation.lastMessageFile);
  if (invocation.outputSchemaFile) args.push("--output-schema", invocation.outputSchemaFile);
  args.push("-");
  return args;
}

/**
 * The whole shell line: change into the repository, hand the key to this process only, run
 * Codex with the prompt on stdin.
 */
export function codexCommand(invocation: CodexInvocation): string {
  const prefix = invocation.apiKeyEnvVar ? `CODEX_API_KEY="$${invocation.apiKeyEnvVar}" ` : "";
  return (
    `cd ${shellQuote(invocation.repoDir)} && ${prefix}codex ${shellJoin(codexArgs(invocation))}` +
    ` < ${shellQuote(invocation.promptFile)}`
  );
}

/** Parses one stdout line. Anything that is not a JSONL event (banners, warnings) is null. */
export function parseCodexLine(line: string): ThreadEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return asThreadEvent(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export type CodexRunSummary = {
  threadId: string | null;
  changedFiles: FileUpdateChange[];
  commands: number;
  failedCommands: number;
  usage: Usage | null;
  /** The last agent message, which is the persona's summary or its structured report. */
  lastMessage: string | null;
  /** Set when the stream reported a turn failure or a fatal error. */
  failure: string | null;
  /** Lines that were not events: the CLI banner, warnings, sandbox errors. */
  noise: string[];
};

export type PersonaTrace = {
  /** The persona's display name, used as the title prefix. */
  persona: string;
  /** `A` or `B`. */
  candidate: string;
};

/** The trace row one completed Codex item becomes, or null for items the console need not see. */
export function traceForEvent(
  event: ThreadEvent,
  context: PersonaTrace,
): Omit<TraceInput, "projectId" | "escalationId" | "source"> | null {
  const prefix = `${context.persona} (${context.candidate})`;
  const base = { persona: context.persona, candidate: context.candidate };

  if (event.type === "turn.failed") {
    return {
      kind: "error",
      status: "failed",
      title: `${prefix}: turn failed`,
      detail: { ...base, message: event.error.message },
    };
  }
  if (event.type === "error") {
    return {
      kind: "error",
      status: "failed",
      title: `${prefix}: ${truncate(event.message, 80)}`,
      detail: { ...base, message: event.message },
    };
  }
  if (event.type !== "item.completed") return null;

  const item = event.item;
  if (item.type === "command_execution") {
    const failed = typeof item.exit_code === "number" && item.exit_code !== 0;
    return {
      kind: "tool",
      status: failed ? "failed" : "ok",
      title: `${prefix}: ${truncate(item.command, 96)}`,
      detail: {
        ...base,
        tool: "codex",
        transport: "shell",
        args_summary: item.command,
        result_summary: tail(item.aggregated_output ?? "", 12),
        exit_code: item.exit_code ?? null,
      },
    };
  }
  if (item.type === "file_change") {
    const count = item.changes.length;
    return {
      kind: "artifact",
      status: item.status === "failed" ? "failed" : "ok",
      title: `${prefix}: changed ${count} file${count === 1 ? "" : "s"}`,
      detail: { ...base, artifact: "file_change", files: item.changes },
    };
  }
  if (item.type === "mcp_tool_call") {
    return {
      kind: "tool",
      status: item.status === "failed" ? "failed" : "ok",
      title: `${prefix}: ${item.server}.${item.tool}`,
      detail: {
        ...base,
        tool: item.tool,
        transport: "mcp",
        args_summary: JSON.stringify(item.arguments ?? null).slice(0, 400),
        result_summary: item.error?.message ?? "ok",
      },
    };
  }
  if (item.type === "agent_message") {
    return {
      kind: "model",
      status: "ok",
      title: `${prefix}: ${truncate(item.text, 96)}`,
      detail: {
        ...base,
        model: CODEX_MODEL,
        purpose: context.persona,
        output_summary: item.text.slice(0, 2000),
      },
    };
  }
  if (item.type === "error") {
    return {
      kind: "error",
      status: "failed",
      title: `${prefix}: ${truncate(item.message, 80)}`,
      detail: { ...base, message: item.message },
    };
  }
  return null;
}

/** `/home/user/novaair/lib/x.ts` -> `lib/x.ts`. Some CLI versions report absolute paths. */
function relativeTo(repoDir: string | undefined, path: string): string {
  if (!repoDir) return path;
  const prefix = repoDir.endsWith("/") ? repoDir : `${repoDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Feeds stdout lines one at a time and keeps the run's summary as they arrive. `onEvent` fires
 * for every parsed event, in order, so the caller can write trace rows while Codex still runs.
 * File paths are made relative to `repoDir` before anyone sees them.
 */
export function codexStream(
  onEvent: (event: ThreadEvent) => void,
  options: { repoDir?: string } = {},
): {
  push(line: string): void;
  readonly summary: CodexRunSummary;
} {
  const summary: CodexRunSummary = {
    threadId: null,
    changedFiles: [],
    commands: 0,
    failedCommands: 0,
    usage: null,
    lastMessage: null,
    failure: null,
    noise: [],
  };
  const byPath = new Map<string, FileUpdateChange>();

  return {
    summary,
    push(line: string) {
      const event = parseCodexLine(line);
      if (!event) {
        if (line.trim() !== "") summary.noise.push(line);
        return;
      }
      if (event.type.startsWith("item.") && "item" in event && event.item.type === "file_change") {
        event.item.changes = event.item.changes.map((change) => ({
          ...change,
          path: relativeTo(options.repoDir, change.path),
        }));
      }
      if (event.type === "thread.started") summary.threadId = event.thread_id;
      else if (event.type === "turn.completed") summary.usage = event.usage;
      else if (event.type === "turn.failed") summary.failure = event.error.message;
      else if (event.type === "error") summary.failure = event.message;
      else if (event.type === "item.completed") {
        const item = event.item;
        if (item.type === "command_execution") {
          summary.commands += 1;
          if (typeof item.exit_code === "number" && item.exit_code !== 0) summary.failedCommands += 1;
        } else if (item.type === "file_change" && item.status === "completed") {
          for (const change of item.changes) {
            const earlier = byPath.get(change.path);
            // A file added then edited in the same run is still an addition to the reviewer.
            byPath.set(change.path, earlier?.kind === "add" && change.kind === "update" ? earlier : change);
          }
          summary.changedFiles = [...byPath.values()];
        } else if (item.type === "agent_message") {
          summary.lastMessage = item.text;
        }
      }
      onEvent(event);
    },
  };
}

const SANDBOX_FAILURE = /landlock|seccomp|sandbox.*(unavailable|not supported|failed|denied|error)|failed to (create|start|init).*sandbox/i;

/**
 * True when a run died before its first turn with the sandbox as the stated reason. That is the
 * signal to retry with Codex's own sandbox off, inside a box that is already a sandbox.
 */
export function looksLikeSandboxFailure(exitCode: number, summary: CodexRunSummary): boolean {
  if (exitCode === 0 || summary.usage !== null) return false;
  const text = [...summary.noise, summary.failure ?? ""].join("\n");
  return SANDBOX_FAILURE.test(text);
}
