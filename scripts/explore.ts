#!/usr/bin/env -S npx tsx
/**
 * Explores a site into a project's product map, from a machine that has a browser.
 *
 *   npm run explore -- --project novaair --url https://<host site>   # one site, now
 *   npm run explore -- --drain                                       # every queued job, then exit
 *   npm run explore -- --watch                                       # keep draining, like the runner
 *
 * The console's "Explore site" button only queues a job, because a serverless function has no
 * browser; `--drain` or the forge runner is what carries it. Run through your secret manager.
 */
import { connect } from "./lib/pg-client.mjs";
import { parseExploreArgs } from "../apps/web/lib/graph/explore-args";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = (): string => new Date().toISOString().slice(11, 19);
const say = (line: string): void => console.log(`${stamp()} ${line}`);

async function projectBySlug(slug: string): Promise<{ id: string; siteUrl: string | null }> {
  const client = await connect();
  try {
    const result = await client.query("select id, site_url from project where slug = $1", [slug]);
    const row = result.rows[0];
    if (!row) throw new Error(`no project with slug ${slug}`);
    return { id: row.id as string, siteUrl: (row.site_url as string | null) ?? null };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = parseExploreArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(2);
  }
  const jobs = await import("../apps/web/lib/graph/jobs");

  if (args.mode === "one") {
    const project = await projectBySlug(args.project);
    const siteUrl = args.url ?? project.siteUrl;
    if (!siteUrl) throw new Error(`project ${args.project} has no site address; pass --url`);
    const job = await jobs.startExploration(project.id, siteUrl);
    say(`exploring ${siteUrl} for ${args.project}`);
    const result = await jobs.runClaimedExploration(job, (line) => say(`  ${line}`));
    if (result.status === "failed") throw new Error(result.error ?? "the exploration failed");
    const summary = result.summary;
    if (summary) {
      say(
        `explored ${summary.pages} pages, ${summary.controls} controls, ${summary.transitions} transitions, ` +
          `${summary.reveals} reveals, ${summary.formsTried} forms in ${(summary.durationMs / 1000).toFixed(1)}s`,
      );
    }
    return;
  }

  say(args.mode === "watch" ? "watching the exploration queue" : "draining the exploration queue");
  for (;;) {
    const job = await jobs.claimQueuedExploration();
    if (!job) {
      if (args.mode === "drain") {
        say("nothing queued");
        return;
      }
      await sleep(3_000);
      continue;
    }
    say(`[${job.id.slice(0, 8)}] exploring ${job.siteUrl}`);
    const result = await jobs.runClaimedExploration(job, (line) => say(`[${job.id.slice(0, 8)}] ${line}`));
    say(`[${job.id.slice(0, 8)}] ${result.status}${result.error ? `: ${result.error}` : ""}`);
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
