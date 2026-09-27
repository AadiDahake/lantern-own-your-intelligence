import { redirect } from "next/navigation";
import { ConversationsConsole } from "@/components/console/ConversationsConsole";
import { PageHeader } from "@/components/PageHeader";
import { loadConversationSummaries, loadOutcomeCounts } from "@/lib/console/conversations";
import { currentProjectOrNull } from "@/lib/console/current";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");
  // The list is already on the first paint, so the page never opens on a spinner.
  const [conversations, counts] = await Promise.all([
    loadConversationSummaries(project.id, { limit: 60 }),
    loadOutcomeCounts(project.id),
  ]);

  return (
    <div className="console-fill">
      <PageHeader
        eyebrow="Observability"
        title="Conversations"
        description="Every question the agent has handled, how it ended, and the guidance it gave."
      />
      <ConversationsConsole
        initialConversations={conversations}
        initialCounts={counts}
        siteUrl={project.siteUrl}
      />
    </div>
  );
}
