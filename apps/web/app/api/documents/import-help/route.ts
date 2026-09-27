/**
 * Imports the site's help center into the knowledge base: one document per article, from the
 * help pages the site graph knows or from the sitemap. A console action, so it resolves the
 * caller's project and needs the project's site address.
 */
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { importHelpCenter } from "@/lib/ingest/helpcenter";
import { emitTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Reading and embedding a few dozen articles is minutes of work, not seconds. */
export const maxDuration = 300;

export async function POST(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  if (!project.siteUrl) {
    return Response.json({ error: "Set the site address on the Overview page first." }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await importHelpCenter(project.id, project.siteUrl);
    void emitTrace({
      projectId: project.id,
      source: "agent",
      kind: "tool",
      title: "Imported the help center",
      detail: {
        tool: "help-center-import",
        transport: "rest",
        args_summary: project.siteUrl,
        result_summary: `${result.documents.length} of ${result.pages} articles`,
        problems: result.problems,
        latencyMs: Date.now() - started,
      },
    });
    return Response.json({ documents: result.documents, pages: result.pages, problems: result.problems });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
