/**
 * Exploring the project's site.
 *
 * The work needs a browser, which a serverless function does not have, so POST only queues a job
 * and answers 202. A process on a machine with a browser (the forge runner, or `npm run explore`)
 * claims it and writes the graph; the console polls GET here and the graph tables.
 */
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { enqueueExploration, latestExploration } from "@/lib/graph/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  try {
    return Response.json({ job: await latestExploration(project.id) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;
  if (!project.siteUrl) {
    return Response.json({ error: "Set the site address on the Overview page first." }, { status: 400 });
  }
  try {
    const job = await enqueueExploration(project.id, project.siteUrl);
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
