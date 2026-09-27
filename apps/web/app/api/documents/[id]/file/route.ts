/**
 * The source exactly as it arrived: the uploaded file, or the text a written note was made of.
 *
 * The bucket is private, so the bytes are fetched with the service role and streamed back to the
 * signed-in console rather than handed out as a public URL.
 */
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { corsJson, preflight, withCors } from "@/lib/cors";
import { readOriginal } from "@/lib/ingest/storage";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

type Row = {
  title: string;
  mime: string | null;
  source_ref: string | null;
  source_text: string | null;
  storage_path: string | null;
};

/** The name the browser saves the file under. */
function downloadName(row: Row): string {
  const ref = row.source_ref ?? "";
  const last = ref.split("/").filter(Boolean).pop() ?? "";
  if (last && last.includes(".")) return last;
  return `${row.title || "source"}.md`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { id } = await context.params;
  const { data } = await serviceClient()
    .from("document")
    .select("title, mime, source_ref, source_text, storage_path")
    .eq("id", id)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!data) return corsJson({ error: "No such source." }, { status: 404 });

  const row = data as Row;
  const attachment = new URL(request.url).searchParams.get("download") === "1";
  const disposition = `${attachment ? "attachment" : "inline"}; filename="${downloadName(row).replace(/"/g, "")}"`;

  if (row.storage_path) {
    const blob = await readOriginal(row.storage_path);
    if (!blob) return corsJson({ error: "The original file is no longer stored." }, { status: 404 });
    return withCors(
      new Response(blob.stream(), {
        headers: {
          "content-type": row.mime ?? blob.type ?? "application/octet-stream",
          "content-disposition": disposition,
          "cache-control": "private, max-age=60",
        },
      }),
    );
  }

  // A written note and a crawled page have no file: the text they were made of is the original.
  if (row.source_text) {
    return withCors(
      new Response(row.source_text, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": disposition,
        },
      }),
    );
  }

  return corsJson({ error: "No original was kept for this source." }, { status: 404 });
}
