import { redirect } from "next/navigation";
import { ActivityConsole } from "@/components/console/ActivityConsole";
import { PageHeader } from "@/components/PageHeader";
import { currentProjectOrNull } from "@/lib/console/current";
import { loadConversationSummaries } from "@/lib/console/conversations";
import { loadRequestGroups } from "@/lib/console/groups";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");
  // The first paint carries the two lists already, so the demo never opens on a spinner.
  const [requests, conversations] = await Promise.all([
    loadRequestGroups(project.id),
    loadConversationSummaries(project.id, { limit: 40 }),
  ]);

  return (
    <div className="console-fill">
      <PageHeader
        eyebrow="Activity"
        title="Requests and the live trace"
        description="Every gap the agent found, grouped and weighed by how many people ran into it, with the trace of whatever is running now."
      />
      <ActivityConsole initialRequests={requests} initialConversations={conversations} />
    </div>
  );
}
