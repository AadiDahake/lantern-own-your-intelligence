/** Starts the GitHub link: send the browser to GitHub with a signed state in a cookie. */
import { NextResponse } from "next/server";
import { githubOauthApp } from "@/lib/env";
import { issueState } from "@/lib/github/secret";
import { STATE_COOKIE } from "@/lib/github/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const app = githubOauthApp();
  if (!app) {
    return NextResponse.redirect(
      new URL("/console/repository?github=unavailable", request.url),
    );
  }

  const state = issueState();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", app.clientId);
  authorize.searchParams.set("redirect_uri", app.redirect);
  authorize.searchParams.set("scope", "repo");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 600,
  });
  return response;
}
