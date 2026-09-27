/**
 * The one path every source takes into the database.
 *
 * The row exists before the work starts, so a source that fails halfway is visible as a failed
 * source rather than as nothing at all, and the console can say why.
 */
import { embed } from "../openai";
import { serviceClient } from "../supabase";
import { chunkPages } from "./chunk";
import { storeOriginal } from "./storage";
import type { ChunkDraft, ConsoleDocument, IngestPage, ParsedSource } from "./types";

/** The embeddings endpoint takes a batch; this is the size the rest of the pipeline is sized for. */
const EMBED_BATCH = 32;

export const DOCUMENT_COLUMNS =
  "id, title, source_kind, source_ref, mime, status, page_count, mean_confidence, chunk_count, error, created_at, storage_path";

export function toConsoleDocument(row: Record<string, unknown>): ConsoleDocument {
  return {
    id: String(row.id),
    title: String(row.title),
    sourceKind: String(row.source_kind),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    mime: row.mime == null ? null : String(row.mime),
    status: String(row.status),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    meanConfidence: row.mean_confidence == null ? null : Number(row.mean_confidence),
    chunkCount: Number(row.chunk_count ?? 0),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    storagePath: row.storage_path == null ? null : String(row.storage_path),
  };
}

/** Mean confidence across the pages that carry one, or null when nothing was scanned. */
function meanPageConfidence(pages: IngestPage[]): number | null {
  const scores = pages
    .map((page) => page.confidence)
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function documentFields(source: ParsedSource): Record<string, unknown> {
  return {
    title: source.title,
    source_kind: source.kind,
    source_ref: source.sourceRef,
    mime: source.mime,
    status: "processing",
    // A written note is one page in name only, so it does not claim a page count.
    page_count: source.kind === "text" ? null : source.pages.length,
    mean_confidence: meanPageConfidence(source.pages),
    pages: source.pages.map((page) => ({
      page: page.page,
      sourceRef: page.sourceRef,
      markdown: page.markdown,
      confidence: page.confidence,
      blocks: page.blocks,
    })),
    source_text: source.sourceText,
    chunk_count: 0,
    error: null,
  };
}

/**
 * Puts the uploaded file in the bucket and records where it went.
 *
 * A storage hiccup is not worth throwing away a scan that took minutes, so the source stays
 * usable and the console simply says the original was not kept.
 */
async function keepOriginal(
  projectId: string,
  documentId: string,
  source: ParsedSource,
): Promise<void> {
  if (!source.original) return;
  try {
    const storagePath = await storeOriginal(projectId, documentId, source.original);
    await serviceClient().from("document").update({ storage_path: storagePath }).eq("id", documentId);
  } catch (failure) {
    console.warn(`Original of document ${documentId} was not stored:`, failure);
  }
}

async function insertChunks(
  projectId: string,
  documentId: string,
  drafts: ChunkDraft[],
): Promise<void> {
  const client = serviceClient();

  for (let start = 0; start < drafts.length; start += EMBED_BATCH) {
    const batch = drafts.slice(start, start + EMBED_BATCH);
    const vectors = await embed(batch.map((draft) => draft.content));
    const { error } = await client.from("chunk").insert(
      batch.map((draft, index) => ({
        document_id: documentId,
        project_id: projectId,
        ordinal: start + index,
        heading: draft.heading,
        content: draft.content,
        page: draft.page,
        block_type: draft.blockType,
        confidence: draft.confidence,
        source_ref: draft.sourceRef,
        embedding: vectors[index],
      })),
    );
    if (error) throw new Error(`Chunks could not be stored: ${error.message}`);
  }
}

/**
 * Chunks, embeds and stores a parsed source against an existing document row, then marks the row
 * ready. A failure marks the row failed with the reason and rethrows, so the caller can answer
 * with the same message the row now carries.
 */
async function fill(projectId: string, documentId: string, source: ParsedSource): Promise<ConsoleDocument> {
  const client = serviceClient();
  try {
    const drafts = chunkPages(source.pages);
    if (drafts.length === 0) throw new Error("No readable text was found in that source.");

    await insertChunks(projectId, documentId, drafts);

    const { data, error } = await client
      .from("document")
      .update({ status: "ready", chunk_count: drafts.length, error: null })
      .eq("id", documentId)
      .select(DOCUMENT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toConsoleDocument(data as Record<string, unknown>);
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : "Ingestion failed.";
    await client.from("document").update({ status: "failed", error: reason }).eq("id", documentId);
    throw failure instanceof Error ? failure : new Error(reason);
  }
}

/** Adds a new source to a project. */
export async function ingestSource(
  projectId: string,
  source: ParsedSource,
): Promise<ConsoleDocument> {
  const { data, error } = await serviceClient()
    .from("document")
    .insert({ project_id: projectId, ...documentFields(source) })
    .select("id")
    .single();
  if (error) throw new Error(`The source could not be stored: ${error.message}`);

  const documentId = String((data as { id: string }).id);
  await keepOriginal(projectId, documentId, source);
  return fill(projectId, documentId, source);
}

/** Replaces everything a document had with what its source says now. */
export async function reingestSource(
  projectId: string,
  documentId: string,
  source: ParsedSource,
): Promise<ConsoleDocument> {
  const client = serviceClient();
  await client.from("chunk").delete().eq("document_id", documentId);

  const { error } = await client
    .from("document")
    .update(documentFields(source))
    .eq("id", documentId);
  if (error) throw new Error(`The source could not be stored: ${error.message}`);

  // No new file means the source was read again from its address or its note, so whatever
  // original the row already had stays exactly where it is.
  await keepOriginal(projectId, documentId, source);
  return fill(projectId, documentId, source);
}
