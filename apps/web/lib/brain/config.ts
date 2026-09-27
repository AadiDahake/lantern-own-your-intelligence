/**
 * Where the company brain lives: the MCP address of a GBrain workspace and the token for it.
 *
 * Both variables travel together, so the brain is off unless both are set. `GBRAIN_MCP_URL` and
 * `GBRAIN_TOKEN` are the names a deployment uses; the second pair is what the vault calls the
 * same two values, so a command run under the vault needs no renaming step.
 */
export type BrainWorkspace = { url: string; token: string };

const URL_NAMES = ["GBRAIN_MCP_URL", "gbrain_mcp_url_hackathon"] as const;
const TOKEN_NAMES = ["GBRAIN_TOKEN", "gbrain_token_hackathon"] as const;

/**
 * The token itself, from any of the three forms it is copied around in: the bare token,
 * `Bearer <token>`, or the whole header line `Authorization: Bearer <token>`.
 */
export function bearerTokenOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? "").replace(/^["']+|["']+$/g, "");
}

function firstSet(env: Record<string, string | undefined>, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/** The workspace to read and write, or null when the brain is not configured. */
export function brainWorkspace(env: Record<string, string | undefined> = process.env): BrainWorkspace | null {
  const url = firstSet(env, URL_NAMES);
  const token = bearerTokenOf(firstSet(env, TOKEN_NAMES));
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { url, token };
}
