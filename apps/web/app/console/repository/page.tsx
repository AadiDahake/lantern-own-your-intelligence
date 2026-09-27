import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { RepositoryConnect } from "@/components/console/RepositoryConnect";
import { currentProjectOrNull } from "@/lib/console/current";
import { listRepositories, type GithubRepository } from "@/lib/github";
import { githubOauthApp } from "@/lib/env";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** What came back on the query string after a round trip to GitHub. */
const LINK_MESSAGES: Record<string, string> = {
  linked: "",
  denied: "The GitHub authorisation was cancelled.",
  state: "That link attempt expired. Start it again.",
  failed: "GitHub did not complete the link. Try again.",
  unavailable: "GitHub linking is not configured on this deployment.",
  signedout: "Your session expired before GitHub came back. Sign in and try again.",
};

export default async function RepositoryPage({ searchParams }: Props) {
  const [project, params] = await Promise.all([currentProjectOrNull(), searchParams]);
  if (!project) redirect("/signin");
  const outcome = typeof params.github === "string" ? params.github : "";

  // An account is linked but nothing is bound, so the choices are the page: fetch them here rather
  // than opening on an empty list that fills in a moment later.
  let repositories: GithubRepository[] = [];
  let listError = "";
  if (project.githubLogin && !project.repoFullName) {
    try {
      repositories = await listRepositories(project.id);
    } catch (error) {
      listError = (error as Error).message;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Repository"
        title="Where Lantern does the work"
        description="The repository the agent reads for evidence, and where it files issues and opens draft pull requests."
      />
      <RepositoryConnect
        repoFullName={project.repoFullName}
        repoDefaultBranch={project.repoDefaultBranch}
        githubLogin={project.githubLogin}
        githubAvatar={project.githubAvatar}
        oauthAvailable={githubOauthApp() !== null}
        initialRepositories={repositories}
        initialError={LINK_MESSAGES[outcome] || listError}
      />
    </>
  );
}
