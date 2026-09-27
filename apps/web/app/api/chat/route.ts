/** Streams one support turn to the widget as server-sent events. */
import { preflight, withCors } from "@/lib/cors";
import { serviceClient } from "@/lib/supabase";
import { runTurn } from "@/lib/agent/turn";
import { continueGuidance } from "@/lib/agent/continue";
import type { ChatRequest } from "@lantern/shared";

export const runtime = "nodejs";
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight();
}

type Body = Partial<ChatRequest>;

/** The project's routing thresholds, when its settings carry numbers for them. */
function thresholdsOf(settings: unknown): { docsThreshold?: number; interfaceThreshold?: number } {
  const record = (settings ?? {}) as Record<string, unknown>;
  const thresholds: { docsThreshold?: number; interfaceThreshold?: number } = {};
  if (typeof record.docsThreshold === "number") thresholds.docsThreshold = record.docsThreshold;
  if (typeof record.interfaceThreshold === "number") thresholds.interfaceThreshold = record.interfaceThreshold;
  return thresholds;
}

/** One or more events as a finished server-sent stream, for a response with nothing to wait on. */
function sse(events: ({ type: string } & Record<string, unknown>)[]): Response {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Body;
  const { key, question, page } = body;
  if (!key || !question || !page) {
    return withCors(Response.json({ error: "key, question and page are required" }, { status: 400 }));
  }

  const { data: project } = await serviceClient()
    .from("project")
    .select("id, repo_full_name, repo_default_branch, site_url, settings")
    .eq("embed_key", key)
    .maybeSingle();
  if (!project) {
    return withCors(Response.json({ error: "unknown key" }, { status: 403 }));
  }

  // Continuing a walkthrough is a different job from answering a question: the answer already
  // exists and the user is waiting mid-flow, so it skips straight to the steps that are left.
  if (typeof body.continueFrom === "number" && body.conversationId) {
    const { text, steps, routeChanged } = await continueGuidance({
      projectId: project.id as string,
      conversationId: body.conversationId,
      question,
      page,
      continueFrom: body.continueFrom,
    });
    return withCors(
      sse([{ type: "answer", text, steps, escalation: { offered: false }, routeChanged }]),
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: { type: string } & Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of runTurn({
          projectId: project.id as string,
          repoFullName: (project.repo_full_name as string) ?? null,
          defaultBranch: (project.repo_default_branch as string) ?? "main",
          siteUrl: (project.site_url as string) ?? null,
          question,
          page,
          conversationId: body.conversationId,
          visitorId: typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : undefined,
          thresholds: thresholdsOf(project.settings),
        })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: (error as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return withCors(
    new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    }),
  );
}
