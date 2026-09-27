/**
 * Reading a source again: a web page as it stands now, a note as it was written, or a file
 * attached in place of one that was only ever read (an upload keeps its row and its history).
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { sourceFromDocument, type StoredDocument } from "@/lib/ingest/request";
import { reingestSource } from "@/lib/ingest/run";
import { fileSource } from "@/lib/ingest/sources";
import type { ParsedSource } from "@/lib/ingest/types";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight();
}

/** A replacement file when one was attached, otherwise whatever the row can be rebuilt from. */
async function sourceFor(request: Request, row: StoredDocument): Promise<ParsedSource> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return sourceFromDocument(row);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("No file was attached.");
  // The row keeps the name it is known by; only its contents are replaced.
  return { ...(await fileSource(file)), title: row.title };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;

  const { data } = await serviceClient()
    .from("document")
    .select("id, title, source_kind, source_ref, source_text, storage_path, mime")
    .eq("id", id)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!data) return corsJson({ error: "No such source." }, { status: 404 });

  try {
    const source = await sourceFor(request, data as StoredDocument);
    const document = await reingestSource(project.id, id, source);
    return corsJson({ document });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "That source could not be read again.";
    return corsJson({ error: message }, { status: 400 });
  }
}
