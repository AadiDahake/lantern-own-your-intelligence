/** Text to speech for the widget, streamed so playback starts quickly. */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";
import { speakStream } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { key?: string; text?: string };
  if (!body.key || !body.text) {
    return withCors(Response.json({ error: "key and text are required" }, { status: 400 }));
  }

  const { data: project } = await serviceClient()
    .from("project")
    .select("id, settings")
    .eq("embed_key", body.key)
    .maybeSingle();
  if (!project) return withCors(Response.json({ error: "unknown key" }, { status: 403 }));

  const settings = (project.settings ?? {}) as { voice?: string };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of speakStream(body.text as string, settings.voice)) {
          controller.enqueue(chunk);
        }
      } catch {
        // A partial answer already played; closing is better than an error tone.
      } finally {
        controller.close();
      }
    },
  });

  return withCors(
    new Response(stream, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    }),
  );
}
