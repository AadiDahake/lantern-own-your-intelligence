/**
 * Carrying one exploration job, on a machine that has a browser.
 *
 * The forge runner and `npm run explore` call this for a row they claimed. It is the only module
 * that joins the job queue to the explorer, so it is the only one that pulls in Playwright; a
 * route imports `./jobs` and never this.
 */
import { emitTrace } from "../trace";
import { exploreSite } from "./explorer";
import { failExploration, finishExploration, type ExploreJob } from "./jobs";

/** Runs a claimed job to the end and records how it went. Never throws: the row carries the error. */
export async function runClaimedExploration(
  job: ExploreJob,
  log: (line: string) => void = () => undefined,
): Promise<ExploreJob> {
  try {
    const summary = await exploreSite({ projectId: job.projectId, siteUrl: job.siteUrl, onProgress: log });
    const done = await finishExploration(job, summary);
    void emitTrace({
      projectId: job.projectId,
      source: "agent",
      kind: "tool",
      title: "Explored the site",
      detail: {
        tool: "explorer",
        transport: "shell",
        args_summary: job.siteUrl,
        result_summary: `${summary.pages} pages, ${summary.controls} controls, ${summary.transitions} transitions, ${summary.reveals} reveals`,
        latencyMs: summary.durationMs,
      },
    });
    return done;
  } catch (failure) {
    const message = (failure as Error).message;
    const failed = await failExploration(job, message);
    void emitTrace({
      projectId: job.projectId,
      source: "agent",
      kind: "error",
      status: "failed",
      title: "The site could not be explored",
      detail: { message, siteUrl: job.siteUrl },
    });
    return failed;
  }
}
