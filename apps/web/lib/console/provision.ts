/**
 * Creating the one project an account owns.
 *
 * Sign-up makes it up front. Sign-in makes it lazily, so an account that predates the owner column
 * gets a workspace the first time it opens the console instead of an error page.
 */
import { randomBytes } from "node:crypto";
import type { Account } from "@/lib/auth/server";
import {
  PROJECT_COLUMNS,
  loadProjectByOwner,
  toProject,
  type ConsoleProject,
} from "@/lib/console/project";
import { serviceClient } from "@/lib/supabase";

/** The thresholds the agent starts with. A project can tune them later through PATCH /api/project. */
const DEFAULT_SETTINGS = { docsThreshold: 0.62, interfaceThreshold: 0.5, voice: "marin" };

const SLUG_ATTEMPTS = 12;
const UNIQUE_VIOLATION = "23505";

/** A URL-safe name from whatever the customer typed into the company field. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "workspace";
}

/** The public key the widget sends with every request. */
export function newEmbedKey(): string {
  return `pk_${randomBytes(12).toString("hex")}`;
}

/** What to call a workspace when the account has no company name on it. */
export function companyFor(account: Account): string {
  return account.company?.trim() || account.email.split("@")[0] || "Workspace";
}

/**
 * Creates the project an account owns: its own slug, its own embed key, no site and no repository.
 *
 * The slug is suffixed until it lands, and a collision on the owner means a parallel request won
 * the race, so that project is returned instead.
 */
export async function createProject(ownerId: string, company: string): Promise<ConsoleProject> {
  const base = slugify(company);

  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const { data, error } = await serviceClient()
      .from("project")
      .insert({
        owner_id: ownerId,
        slug,
        name: company,
        company,
        embed_key: newEmbedKey(),
        settings: DEFAULT_SETTINGS,
      })
      .select(PROJECT_COLUMNS)
      .maybeSingle();

    if (data) return toProject(data as Record<string, unknown>);
    if (error?.code !== UNIQUE_VIOLATION) {
      throw new Error(`The workspace could not be created. ${error?.message ?? "No row came back."}`);
    }

    const existing = await loadProjectByOwner(ownerId);
    if (existing) return existing;
  }

  throw new Error(`No free slug for "${company}" after ${SLUG_ATTEMPTS} attempts.`);
}

/** The account's project, created on the spot when it has none. */
export async function ensureProject(account: Account): Promise<ConsoleProject> {
  return (await loadProjectByOwner(account.id)) ?? (await createProject(account.id, companyFor(account)));
}
