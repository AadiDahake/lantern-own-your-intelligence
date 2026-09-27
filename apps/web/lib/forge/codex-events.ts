/**
 * The JSONL events `codex exec --json` prints, one per line.
 *
 * These are the `ThreadEvent` and `ThreadItem` types of `@openai/codex-sdk` 0.151.0
 * (`dist/index.d.ts`), reproduced here field for field. The SDK is not a dependency: its only
 * runtime dependency is the Codex CLI itself, a 350 MB platform binary, and the engine never
 * spawns Codex through the SDK. It runs the CLI inside a sandbox and parses this wire format.
 * When the CLI version pinned in `codex.ts` moves, re-read the SDK's types at that version.
 */

export type CommandExecutionStatus = "in_progress" | "completed" | "failed";

/** A command executed by the agent. */
export type CommandExecutionItem = {
  id: string;
  type: "command_execution";
  /** The command line executed by the agent. */
  command: string;
  /** Aggregated stdout and stderr captured while the command was running. */
  aggregated_output: string;
  /** Set when the command exits; omitted while still running. */
  exit_code?: number;
  status: CommandExecutionStatus;
};

export type PatchChangeKind = "add" | "delete" | "update";

export type FileUpdateChange = { path: string; kind: PatchChangeKind };

export type PatchApplyStatus = "completed" | "failed";

/** A set of file changes by the agent. Emitted once the patch succeeds or fails. */
export type FileChangeItem = {
  id: string;
  type: "file_change";
  changes: FileUpdateChange[];
  status: PatchApplyStatus;
};

export type McpToolCallStatus = "in_progress" | "completed" | "failed";

export type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server: string;
  tool: string;
  arguments: unknown;
  result?: { content: unknown[]; _meta?: unknown; structured_content: unknown };
  error?: { message: string };
  status: McpToolCallStatus;
};

/** Natural-language text, or JSON when structured output was requested. */
export type AgentMessageItem = { id: string; type: "agent_message"; text: string };

export type ReasoningItem = { id: string; type: "reasoning"; text: string };

export type WebSearchItem = { id: string; type: "web_search"; query: string };

/** A non-fatal error surfaced as an item. */
export type ErrorItem = { id: string; type: "error"; message: string };

export type TodoItem = { text: string; completed: boolean };

export type TodoListItem = { id: string; type: "todo_list"; items: TodoItem[] };

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem;

export type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

export type ThreadStartedEvent = { type: "thread.started"; thread_id: string };
export type TurnStartedEvent = { type: "turn.started" };
export type TurnCompletedEvent = { type: "turn.completed"; usage: Usage };
export type TurnFailedEvent = { type: "turn.failed"; error: { message: string } };
export type ItemStartedEvent = { type: "item.started"; item: ThreadItem };
export type ItemUpdatedEvent = { type: "item.updated"; item: ThreadItem };
export type ItemCompletedEvent = { type: "item.completed"; item: ThreadItem };
/** An unrecoverable error emitted directly by the event stream. */
export type ThreadErrorEvent = { type: "error"; message: string };

/** Top-level JSONL events emitted by `codex exec --json`. */
export type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemStartedEvent
  | ItemUpdatedEvent
  | ItemCompletedEvent
  | ThreadErrorEvent;

const EVENT_TYPES = new Set<string>([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
]);

const ITEM_TYPES = new Set<string>([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "todo_list",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrows one parsed JSON value to a `ThreadEvent`, or returns null for anything else.
 *
 * The check is structural and shallow on purpose: the CLI is the source of truth for the
 * payloads, and a stricter parser would reject a new optional field rather than pass it through.
 */
export function asThreadEvent(value: unknown): ThreadEvent | null {
  if (!isRecord(value) || typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) {
    return null;
  }
  if (value.type.startsWith("item.")) {
    const item = value.item;
    if (!isRecord(item) || typeof item.type !== "string" || !ITEM_TYPES.has(item.type)) {
      return null;
    }
  }
  return value as ThreadEvent;
}
