#!/usr/bin/env -S npx tsx
/**
 * Fills a project's product map and knowledge base from its site.
 *
 * Explores the site with a headless browser into the site graph, then imports the help center it
 * found as documents. Run through your secret manager, the same way as the other scripts:
 *
 *   npm run seed:site                 # both steps, project LANTERN_PROJECT_SLUG (default novaair)
 *   npm run seed:site -- --explore    # the graph only
 *   npm run seed:site -- --help-center
 *
 * The site is LANTERN_SITE_URL, or the project's stored site address.
 */
import { connect } from "./lib/pg-client.mjs";

const SLUG = process.env.LANTERN_PROJECT_SLUG ?? "novaair";
const args = process.argv.slice(2);
const wantExplore = args.includes("--explore") || !args.includes("--help-center");
const wantHelp = args.includes("--help-center") || !args.includes("--explore");

async function project(): Promise<{ id: string; siteUrl: string | null }> {
  const client = await connect();
  try {
    const result = await client.query("select id, site_url from project where slug = $1", [SLUG]);
    const row = result.rows[0];
    if (!row) throw new Error(`no project with slug ${SLUG}; run npm run db:seed first`);
    return { id: row.id as string, siteUrl: (row.site_url as string | null) ?? null };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const { id, siteUrl: stored } = await project();
  const siteUrl = process.env.LANTERN_SITE_URL || stored;
  if (!siteUrl) {
    console.error("No site address: set LANTERN_SITE_URL or the project's site on the Overview page.");
    process.exit(1);
  }

  if (wantExplore) {
    const { exploreSite } = await import("../apps/web/lib/graph/explorer");
    console.log(`exploring ${siteUrl}`);
    const summary = await exploreSite({ projectId: id, siteUrl, onProgress: (line) => console.log(`  ${line}`) });
    console.log(
      `explored ${summary.pages} pages, ${summary.controls} controls, ${summary.transitions} transitions, ` +
        `${summary.reveals} reveals, ${summary.formsTried} forms in ${(summary.durationMs / 1000).toFixed(1)}s`,
    );
    if (summary.skipped.length > 0) console.log(`  skipped: ${summary.skipped.join(", ")}`);
  }

  if (wantHelp) {
    const { importHelpCenter } = await import("../apps/web/lib/ingest/helpcenter");
    console.log("importing the help center");
    const result = await importHelpCenter(id, siteUrl);
    for (const document of result.documents) {
      console.log(`  ${document.title}: ${document.chunkCount} chunks`);
    }
    for (const problem of result.problems) console.warn(`  warning: ${problem}`);
    console.log(`imported ${result.documents.length} of ${result.pages} help pages`);
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
