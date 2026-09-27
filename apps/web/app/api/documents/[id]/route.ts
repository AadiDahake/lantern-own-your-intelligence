/** One source: what was read out of it, and removing it. */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { DOCUMENT_COLUMNS, toConsoleDocument } from "@/lib/ingest/run";
import { removeOriginals } from "@/lib/ingest/storage";
import type { IngestPage } from "@/lib/ingest/types";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

/** The document with every page's extracted text, so the console can show what was read. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;
  const { data, error } = await serviceClient()
    .from("document")
    .select(`${DOCUMENT_COLUMNS}, pages`)
    .eq("id", id)
    .eq("project_id", project.id)
    .maybeSingle();

  if (error) return corsJson({ error: error.message }, { status: 500 });
  if (!data) return corsJson({ error: "No such source." }, { status: 404 });

  const row = data as Record<string, unknown>;
  const stored = Array.isArray(row.pages) ? (row.pages as IngestPage[]) : [];
  // Sources added before pages were kept still have their passages, and those are what the
  // agent actually reads, so the console shows them rather than an empty panel.
  const pages = stored.length > 0 ? stored : await pagesFromChunks(id);
  return corsJson({ document: { ...toConsoleDocument(row), pages } });
}

/** The passages a document produced, regrouped into the pages they came from. */
async function pagesFromChunks(documentId: string): Promise<IngestPage[]> {
  const { data } = await serviceClient()
    .from("chunk")
    .select("ordinal, heading, content, page, block_type, confidence, source_ref")
    .eq("document_id", documentId)
    .order("ordinal", { ascending: true });

  const byPage = new Map<number, IngestPage>();
  for (const row of data ?? []) {
    const number = row.page === null || row.page === undefined ? 1 : Number(row.page);
    const page = byPage.get(number) ?? {
      page: number,
      sourceRef: row.source_ref === null ? null : String(row.source_ref),
      markdown: "",
      confidence: null,
      blocks: [],
    };
    page.blocks.push({
      type: String(row.block_type ?? "text"),
      content: String(row.content),
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    });
    byPage.set(number, page);
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/** Removing a source takes its chunks with it, so the agent stops answering from it at once. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;
  const { error } = await serviceClient()
    .from("document")
    .delete()
    .eq("id", id)
    .eq("project_id", project.id);
  if (error) return corsJson({ error: error.message }, { status: 500 });
  // The row is gone either way; a leftover file in the bucket is not worth failing the call.
  await removeOriginals(project.id, id).catch(() => undefined);
  return corsJson({ ok: true });
}
