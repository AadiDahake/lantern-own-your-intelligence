/** The GitHub OAuth exchange, shared by the connect and callback routes. */
import { githubOauthApp } from "@/lib/env";
import type { GithubConnection } from "./connection";

/** Holds the signed state between the redirect out and the redirect back. */
export const STATE_COOKIE = "lantern_github_state";

/** Trades the authorization code for an access token. */
export async function exchangeCode(code: string): Promise<string> {
  const app = githubOauthApp();
  if (!app) throw new Error("GitHub linking is not configured on this deployment.");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: app.redirect,
      code,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub refused the code.");
  }
  return payload.access_token;
}

/** Who the token belongs to. */
export async function fetchGithubUser(accessToken: string): Promise<GithubConnection> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub rejected the account lookup (${response.status}).`);

  const payload = (await response.json()) as { login?: string; avatar_url?: string | null };
  if (!payload.login) throw new Error("GitHub did not return an account name.");
  return { login: payload.login, avatar: payload.avatar_url ?? null };
}
