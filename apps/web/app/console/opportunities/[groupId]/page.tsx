import { notFound, redirect } from "next/navigation";
import { OpportunityDetail } from "@/components/console/opportunity/OpportunityDetail";
import { currentProjectOrNull } from "@/lib/console/current";
import { forgeTargetRepo } from "@/lib/env";
import { loadOpportunity } from "@/lib/opportunity/read";

export const dynamic = "force-dynamic";

/** One opportunity, told in the order the story runs. The first paint carries everything. */
export default async function OpportunityPage({ params }: { params: Promise<{ groupId: string }> }) {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");
  const { groupId } = await params;
  const opportunity = await loadOpportunity(project.id, groupId);
  if (!opportunity) notFound();
  // The repository a forge run targets: the project's, else the configured default.
  return <OpportunityDetail initial={opportunity} repoFullName={project.repoFullName ?? forgeTargetRepo()} />;
}
