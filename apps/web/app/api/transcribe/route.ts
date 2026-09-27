/** Speech to text for the widget's microphone. */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";
import { transcribe } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withCors(Response.json({ error: "expected a multipart body" }, { status: 400 }));
  }

  const key = form.get("key");
  const file = form.get("file");
  if (typeof key !== "string" || !(file instanceof Blob)) {
    return withCors(Response.json({ error: "key and file are required" }, { status: 400 }));
  }

  const { data: project } = await serviceClient()
    .from("project")
    .select("id")
    .eq("embed_key", key)
    .maybeSingle();
  if (!project) return withCors(Response.json({ error: "unknown key" }, { status: 403 }));

  // An empty capture is a user who tapped the microphone and said nothing.
  if (file.size < 1200) return withCors(Response.json({ text: "" }));

  try {
    const name = file.type.includes("mp4") ? "speech.mp4" : "speech.webm";
    const text = await transcribe(file, name);
    return withCors(Response.json({ text }));
  } catch (error) {
    return withCors(Response.json({ error: (error as Error).message }, { status: 502 }));
  }
}
