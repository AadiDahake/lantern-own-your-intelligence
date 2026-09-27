/** Finishes the GitHub link: verify the state, exchange the code, store the account and its token. */
import { NextResponse } from "next/server";
import { currentProjectOrNull } from "@/lib/console/current";
import { saveConnection } from "@/lib/github/connection";
import { STATE_COOKIE, exchangeCode, fetchGithubUser } from "@/lib/github/oauth";
import { verifyState } from "@/lib/github/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(request: Request, status: string): NextResponse {
  const target = new URL("/console/repository", request.url);
  target.searchParams.set("github", status);
  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.get("error")) return back(request, "denied");

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!code || !state || state !== cookieState || !verifyState(state)) {
    return back(request, "state");
  }

  const project = await currentProjectOrNull();
  if (!project) return back(request, "signedout");

  try {
    const accessToken = await exchangeCode(code);
    const user = await fetchGithubUser(accessToken);
    await saveConnection(project.id, user, accessToken);
  } catch {
    return back(request, "failed");
  }

  return back(request, "linked");
}
