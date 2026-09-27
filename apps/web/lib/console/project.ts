import { appUrl } from "@/lib/env";
import { serviceClient } from "@/lib/supabase";

/** One account's workspace, as the console pages and routes consume it. */
export type ConsoleProject = {
  id: string;
  slug: string;
  name: string;
  /** The company name from the sign-up form. It is what the console shows as the project name. */
  company: string | null;
  embedKey: string;
  siteUrl: string | null;
  repoFullName: string | null;
  repoDefaultBranch: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  /** When the four onboarding steps first all read done. */
  onboardedAt: string | null;
  /** The linked GitHub account. The access token itself never leaves the server. */
  githubLogin: string | null;
  githubAvatar: string | null;
};

export const PROJECT_COLUMNS =
  "id, slug, name, company, embed_key, site_url, repo_full_name, repo_default_branch, settings, created_at, onboarded_at, github_login, github_avatar";

function toProject(row: Record<string, unknown>): ConsoleProject {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    company: row.company ? String(row.company) : null,
    embedKey: String(row.embed_key),
    siteUrl: row.site_url === null ? null : String(row.site_url),
    repoFullName: row.repo_full_name === null ? null : String(row.repo_full_name),
    repoDefaultBranch: row.repo_default_branch === null ? null : String(row.repo_default_branch),
    settings: (row.settings ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    onboardedAt: row.onboarded_at ? String(row.onboarded_at) : null,
    githubLogin: row.github_login ? String(row.github_login) : null,
    githubAvatar: row.github_avatar ? String(row.github_avatar) : null,
  };
}

/** The project an account owns, or null when it has none yet. */
export async function loadProjectByOwner(ownerId: string): Promise<ConsoleProject | null> {
  const { data } = await serviceClient()
    .from("project")
    .select(PROJECT_COLUMNS)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data ? toProject(data as Record<string, unknown>) : null;
}

/** The project with this slug, or null. Only the console token path resolves a project this way. */
export async function loadProjectBySlug(slug: string): Promise<ConsoleProject | null> {
  const { data } = await serviceClient().from("project").select(PROJECT_COLUMNS).eq("slug", slug).maybeSingle();
  return data ? toProject(data as Record<string, unknown>) : null;
}

/** The name the console shows: the company from sign-up, falling back to the stored name. */
export function projectDisplayName(project: ConsoleProject): string {
  return project.company?.trim() || project.name;
}

/** The script tag a customer pastes into their own page. */
export function embedSnippet(embedKey: string): string {
  return `<script src="${appUrl()}/widget.js"\n        data-key="${embedKey}" async></script>`;
}

export function widgetUrl(): string {
  return `${appUrl()}/widget.js`;
}

export { toProject };
