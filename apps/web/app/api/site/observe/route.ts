/**
 * The widget's report of a page it scanned and a move the user just made.
 *
 * This is the second source of the site graph: real people exploring the product. Widget-facing,
 * so it takes the embed key and answers cross-origin. It writes at most one page and one
 * transition per call and never answers with an error the widget could act on; a bad report is
 * simply not recorded.
 */
import { corsJson, preflight } from "@/lib/cors";
import { controlKey, routeOf } from "@lantern/shared";
import type { PageContext } from "@lantern/shared";
import { belongsToSite } from "@/lib/graph/origin";
import { recordScan, recordTransition } from "@/lib/graph/store";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

type Body = {
  key?: unknown;
  page?: unknown;
  transition?: unknown;
};

const MAX_AFFORDANCES = 400;

function asPage(value: unknown): PageContext | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (typeof page.url !== "string" || !Array.isArray(page.affordances)) return null;
  const affordances = page.affordances
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .slice(0, MAX_AFFORDANCES)
    .flatMap((entry) => {
      if (typeof entry.id !== "string" || typeof entry.role !== "string" || typeof entry.name !== "string") return [];
      const affordance: PageContext["affordances"][number] = {
        id: entry.id,
        role: entry.role,
        name: entry.name.slice(0, 200),
        visible: entry.visible !== false,
      };
      if (typeof entry.landmark === "string") affordance.landmark = entry.landmark;
      if (typeof entry.href === "string") affordance.href = entry.href;
      if (entry.disabled === true) affordance.disabled = true;
      if (typeof entry.state === "string") affordance.state = entry.state;
      return [affordance];
    });
  return { url: page.url, title: typeof page.title === "string" ? page.title : "", affordances };
}

type Transition = { fromUrl: string; control: { role: string; name: string; landmark?: string; href?: string } };

function asTransition(value: unknown): Transition | null {
  if (typeof value !== "object" || value === null) return null;
  const transition = value as Record<string, unknown>;
  const control = transition.control as Record<string, unknown> | undefined;
  if (typeof transition.fromUrl !== "string" || !control) return null;
  if (typeof control.role !== "string" || typeof control.name !== "string") return null;
  const ref: Transition["control"] = { role: control.role, name: control.name };
  if (typeof control.landmark === "string") ref.landmark = control.landmark;
  if (typeof control.href === "string") ref.href = control.href;
  return { fromUrl: transition.fromUrl, control: ref };
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Body;
  const page = asPage(body.page);
  if (typeof body.key !== "string" || !page) {
    return corsJson({ error: "key and page are required" }, { status: 400 });
  }

  const { data: project } = await serviceClient()
    .from("project")
    .select("id, site_url")
    .eq("embed_key", body.key)
    .maybeSingle();
  if (!project) return corsJson({ error: "unknown key" }, { status: 403 });
  const projectId = String(project.id);

  // The same rule the turn applies: only the site the project names teaches the product map, so a
  // widget running on a preview deployment is answered and nothing it saw is written down.
  if (!belongsToSite((project.site_url as string) ?? null, page.url)) {
    return corsJson({ ok: true });
  }

  try {
    const toRoute = await recordScan(projectId, page, "widget");
    const transition = asTransition(body.transition);
    if (transition) {
      const fromRoute = routeOf(transition.fromUrl);
      if (fromRoute !== toRoute) {
        await recordTransition(
          projectId,
          { fromRoute, key: controlKey(transition.control), toRoute, kind: "navigation" },
          "widget",
        );
      }
    }
  } catch (error) {
    // The graph is a convenience for later questions; a failed write must not reach the visitor.
    console.warn("site observation not recorded:", (error as Error).message);
  }
  return corsJson({ ok: true });
}
