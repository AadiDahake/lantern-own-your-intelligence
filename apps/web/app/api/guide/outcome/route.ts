/**
 * The widget's report of how a walk ended.
 *
 * Widget-facing, so it takes the embed key and answers cross-origin. A walk that reached its last
 * step is remembered (`lib/routes/provider.ts`), so the next person who asks the same question is
 * answered from it. Any other outcome is acknowledged and changes nothing.
 */
import { corsJson, preflight } from "@/lib/cors";
import { rememberRoute, walkSteps } from "@/lib/routes/provider";
import { serviceClient } from "@/lib/supabase";
import { emitTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

type Body = {
  key?: unknown;
  outcome?: unknown;
  question?: unknown;
  feature?: unknown;
  answer?: unknown;
  steps?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
};

const text = (value: unknown, limit: number): string => (typeof value === "string" ? value.trim().slice(0, limit) : "");

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (typeof body.key !== "string" || typeof body.outcome !== "string") {
    return corsJson({ error: "key and outcome are required" }, { status: 400 });
  }
  const { data: project } = await serviceClient().from("project").select("id").eq("embed_key", body.key).maybeSingle();
  if (!project) return corsJson({ error: "unknown key" }, { status: 403 });
  const projectId = String(project.id);

  if (body.outcome !== "completed") return corsJson({ ok: true, remembered: false });

  const question = text(body.question, 2000);
  const steps = walkSteps(body.steps);
  if (!question || !steps) {
    return corsJson({ error: "a completed walk needs the question and its steps" }, { status: 400 });
  }
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const walkId = text(body.messageId, 80) || `${Date.now().toString(36)}`;

  try {
    const result = await rememberRoute(projectId, question, {
      walkId,
      feature: text(body.feature, 200) || question,
      answer: text(body.answer, 4000),
      steps,
    });
    if (result.status === "skipped") {
      void emitTrace({
        projectId,
        conversationId,
        source: "agent",
        kind: "status",
        title: `Walk completed, not remembered: ${result.reason}`,
        detail: { outcome: "completed", steps: steps.length, reason: result.reason },
      });
      return corsJson({ ok: true, remembered: false, reason: result.reason });
    }
    const { route, extraction } = result;
    void emitTrace({
      projectId,
      conversationId,
      source: "agent",
      kind: "decision",
      title: `Remembered a ${route.steps.length} step route, confirmed by ${route.walks} walk${route.walks === 1 ? "" : "s"}`,
      detail: {
        outcome: "completed",
        intent: route.intent,
        steps: route.steps.map((step) => step.caption),
        walks: route.walks,
        memorable: extraction ? extraction.status : "off",
        title: route.title,
      },
    });
    return corsJson({
      ok: true,
      remembered: true,
      steps: route.steps.length,
      walks: route.walks,
      memorable: extraction ? extraction.status : "off",
    });
  } catch (error) {
    // Memory is a convenience; a failed write must never reach the visitor as an error.
    console.warn("route not remembered:", (error as Error).message);
    return corsJson({ ok: true, remembered: false, reason: "the store could not be written" });
  }
}
