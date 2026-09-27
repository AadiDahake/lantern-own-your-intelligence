import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { KnowledgeConsole } from "@/components/console/knowledge/KnowledgeConsole";
import { currentProjectOrNull } from "@/lib/console/current";
import { DOCUMENT_COLUMNS, toConsoleDocument } from "@/lib/ingest/run";
import type { ConsoleDocument } from "@/lib/ingest/types";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");
  const documents = await loadDocuments(project.id);

  return (
    <>
      <PageHeader
        eyebrow="Knowledge"
        title="What the agent answers from"
        description="Add a handbook, a documentation site or a note. Lantern reads it, splits it into passages and remembers how well it read each one."
      />

      <KnowledgeConsole
        initialDocuments={documents}
        siteUrl={project.siteUrl}
        repoBound={Boolean(project.repoFullName)}
      />
    </>
  );
}

async function loadDocuments(projectId: string): Promise<ConsoleDocument[]> {
  const { data } = await serviceClient()
    .from("document")
    .select(DOCUMENT_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toConsoleDocument);
}
