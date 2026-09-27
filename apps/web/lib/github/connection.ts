/**
 * The GitHub account linked to a project, and the token the agent and the console use for it.
 *
 * The link lives on the project row: an account owns one project, so linking a GitHub account
 * links it for that project and for nothing else.
 */
import { githubToken } from "@/lib/env";
import { serviceClient } from "@/lib/supabase";
import { decryptToken, encryptToken } from "./secret";

export type GithubConnection = {
  login: string;
  avatar: string | null;
};

/** Stores the linked account and its access token, encrypted. */
export async function saveConnection(
  projectId: string,
  connection: GithubConnection,
  accessToken: string,
): Promise<void> {
  const { error } = await serviceClient()
    .from("project")
    .update({
      github_login: connection.login,
      github_avatar: connection.avatar,
      github_token: encryptToken(accessToken),
    })
    .eq("id", projectId);
  if (error) throw new Error(`The GitHub connection could not be stored. ${error.message}`);
}

/** Drops the linked account. The repository binding stays, so the agent keeps working. */
export async function clearConnection(projectId: string): Promise<void> {
  const { error } = await serviceClient()
    .from("project")
    .update({ github_login: null, github_avatar: null, github_token: null })
    .eq("id", projectId);
  if (error) throw new Error(`The GitHub connection could not be cleared. ${error.message}`);
}

/** The linked user's token, or null when nobody has linked an account to this project. */
export async function linkedToken(projectId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from("project")
    .select("github_token")
    .eq("id", projectId)
    .maybeSingle();
  const stored = (data as { github_token?: string | null } | null)?.github_token;
  return stored ? decryptToken(stored) : null;
}

/**
 * The token every GitHub call should use: the project's linked token when there is one, the server
 * credential otherwise. This is the one place that decides.
 */
export async function activeGithubToken(projectId: string): Promise<string> {
  return (await linkedToken(projectId)) ?? githubToken();
}
