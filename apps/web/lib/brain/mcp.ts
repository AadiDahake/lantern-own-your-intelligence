/**
 * The smallest client of a Streamable HTTP MCP server: one POST for each call, and no session.
 *
 * What comes back is input from outside the system, so every answer is parsed into a checked
 * shape here and nothing is cast. An error never carries the address or the token.
 */
import type { BrainWorkspace } from "./config";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let requestId = 0;

/** The last `data:` payload of an event stream, which is where the JSON-RPC answer is. */
function lastEvent(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return lines[lines.length - 1] ?? "";
}

async function rpc(
  workspace: BrainWorkspace,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetch(workspace.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${workspace.token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: (requestId += 1), method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`The brain answered ${response.status} to ${method}`);
  const streamed = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  let parsed: unknown;
  try {
    parsed = JSON.parse(streamed ? lastEvent(body) : body);
  } catch {
    throw new Error(`The brain answered ${method} with something that is not JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`The brain answered ${method} with no result`);
  if (isRecord(parsed.error)) {
    const message = typeof parsed.error.message === "string" ? parsed.error.message : "no reason given";
    throw new Error(`The brain refused ${method}: ${message.slice(0, 300)}`);
  }
  return parsed.result;
}

/** The names of the tools the server offers. */
export async function listTools(workspace: BrainWorkspace, timeoutMs = 15_000): Promise<string[]> {
  const result = await rpc(workspace, "tools/list", {}, timeoutMs);
  const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
  return tools.flatMap((tool) => (isRecord(tool) && typeof tool.name === "string" ? [tool.name] : []));
}

/**
 * Calls one tool and returns what it said: the parsed JSON when its text is JSON, else the text.
 * A tool that reports an error throws with the tool's own words.
 */
export async function callTool(
  workspace: BrainWorkspace,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const result = await rpc(workspace, "tools/call", { name, arguments: args }, timeoutMs);
  if (!isRecord(result)) throw new Error(`The brain answered ${name} with no result`);
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
  if (result.isError === true) throw new Error(`The brain tool ${name} failed: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
