/**
 * What the agent would actually retrieve for a question.
 *
 * This is the same search the documentation probe runs, with nothing on top of it, so what the
 * console shows here is exactly what grounds an answer.
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import type { SearchMatch } from "@/lib/ingest/types";
import { embed } from "@/lib/openai";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_COUNT = 5;

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(request: Request): Promise<Response> {
  const question = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (question === "") return corsJson({ error: "Ask a question first." }, { status: 400 });

  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    const client = serviceClient();
    const [vector] = await embed([question]);
    const { data, error } = await client.rpc("match_chunks", {
      query_embedding: vector,
      match_count: MATCH_COUNT,
      filter_project: project.id,
    });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      id: string;
      document_id: string;
      heading: string | null;
      content: string;
      page: number | null;
      confidence: number | null;
      similarity: number;
    }[];

    const titles = await documentTitles(rows.map((row) => row.document_id));
    const matches: SearchMatch[] = rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      documentTitle: titles.get(row.document_id) ?? "Unknown source",
      heading: row.heading,
      content: row.content,
      page: row.page,
      confidence: row.confidence,
      similarity: row.similarity,
    }));
    return corsJson({ matches });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "The search failed.";
    return corsJson({ error: message }, { status: 500 });
  }
}

async function documentTitles(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await serviceClient().from("document").select("id, title").in("id", unique);
  return new Map((data ?? []).map((row) => [String(row.id), String(row.title)]));
}
