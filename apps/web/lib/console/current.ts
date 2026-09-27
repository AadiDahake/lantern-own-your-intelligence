/**
 * Who is asking, and which project the answer may come from.
 *
 * Every console route and every console page resolves the caller here, and then scopes its queries
 * to the project id this returns. Nothing else decides what an account can see.
 */
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { currentAccount } from "@/lib/auth/server";
import { consoleToken } from "@/lib/env";
import type { ConsoleProject } from "@/lib/console/project";
import { loadProjectBySlug } from "@/lib/console/project";
import { ensureProject } from "@/lib/console/provision";

/** True when `presented` is exactly the configured token, compared in constant time. */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The bearer token on the request, or null. */
export function bearerOf(value: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim() || null;
}

/**
 * A terminal client (`npm run tail`) presents `LANTERN_CONSOLE_TOKEN` instead of a session
 * cookie and reads the project named by `LANTERN_CONSOLE_PROJECT`. Off unless the token is set,
 * so a deployment without the variable behaves exactly as before.
 */
async function tokenProject(): Promise<ConsoleProject | null> {
  const configured = consoleToken();
  if (!configured) return null;
  const presented = bearerOf((await headers()).get("authorization"));
  if (!tokenMatches(presented, configured.token)) return null;
  return loadProjectBySlug(configured.projectSlug);
}

/**
 * The signed-in caller's project.
 *
 * Throws a 401 `Response` when there is no session, so a route can answer with it directly:
 *
 * ```ts
 * const project = await currentProject().catch(asErrorResponse);
 * if (project instanceof Response) return project;
 * ```
 */
export async function currentProject(): Promise<ConsoleProject> {
  const account = await currentAccount();
  if (account) return ensureProject(account);
  const viaToken = await tokenProject();
  if (viaToken) return viaToken;
  throw Response.json({ error: "Sign in to use the console." }, { status: 401 });
}

/** The same, for pages, which redirect rather than answer with a status code. */
export async function currentProjectOrNull(): Promise<ConsoleProject | null> {
  const account = await currentAccount();
  return account ? ensureProject(account) : null;
}

/** Turns the thrown 401 into a value a route can return, and lets every other failure through. */
export function asErrorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  throw error;
}
