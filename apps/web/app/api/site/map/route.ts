/** The product map as the console shows it: the graph, and the routes questions have resolved to. */
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { listKnownRoutes, loadGraph } from "@/lib/graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  try {
    const [graph, routes] = await Promise.all([loadGraph(project.id), listKnownRoutes(project.id)]);
    return Response.json({ graph, routes, siteUrl: project.siteUrl });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
