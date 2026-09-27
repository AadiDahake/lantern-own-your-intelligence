/**
 * The live trace tail.
 *
 * Postgres has no push channel the service role client can hold open cheaply here, so this polls
 * every 700 ms and writes anything new as a server-sent event. Each event carries the row id, so a
 * reconnecting `EventSource` resumes exactly where it stopped through `Last-Event-ID`.
 */
import { withCors, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { fetchTrace, readFilters } from "@/lib/console/traceQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 700;
const PING_MS = 15_000;
/** Closing well inside the platform's limit lets EventSource reconnect on its own terms. */
const LIFETIME_MS = 240_000;

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(request: Request): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const url = new URL(request.url);
  const filters = readFilters(url, project.id);
  const resumeFrom = Number(request.headers.get("last-event-id") ?? "0");
  let cursor = Number.isFinite(resumeFrom) && resumeFrom > filters.since ? resumeFrom : filters.since;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastPing = startedAt;
      let closed = false;

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      };

      request.signal.addEventListener("abort", finish);
      send(": open\n\n");

      while (!closed && Date.now() - startedAt < LIFETIME_MS) {
        try {
          const events = await fetchTrace({ ...filters, since: cursor });
          for (const event of events) {
            cursor = Math.max(cursor, event.id);
            send(`id: ${event.id}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`);
          }
        } catch (error) {
          send(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
        }

        if (Date.now() - lastPing > PING_MS) {
          lastPing = Date.now();
          send(": ping\n\n");
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }

      finish();
    },
  });

  return withCors(
    new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    }),
  );
}
