#!/usr/bin/env -S npx tsx
/**
 * Writes the NovaAir help articles and the known gaps into the company brain, one page for each,
 * through the MCP address of the GBrain workspace.
 *
 *   npx tsx integrations/gbrain/sync.ts
 *
 * Needs the address and the token of the workspace in the environment (`README.md` beside this
 * file). A write replaces the page with the same slug, so a second run changes nothing.
 */
import { readFileSync } from "node:fs";
import { brainWorkspace } from "../../apps/web/lib/brain/config";
import { callTool, listTools } from "../../apps/web/lib/brain/mcp";
import { gapPage, helpPage, type BrainPage, type HelpArticle, type KnownGap } from "./pages";

const PRODUCT = "NovaAir";

function load<T>(name: string): T[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${name} does not hold a list`);
  return parsed as T[];
}

async function main(): Promise<void> {
  const workspace = brainWorkspace();
  if (!workspace) {
    console.error("The brain is not configured. Set GBRAIN_MCP_URL and GBRAIN_TOKEN.");
    process.exitCode = 1;
    return;
  }

  const tools = await listTools(workspace);
  console.log(`The brain offers ${tools.length} tools.`);
  for (const needed of ["put_page", "search"]) {
    if (!tools.includes(needed)) throw new Error(`The brain has no tool named ${needed}`);
  }

  const articles = load<HelpArticle>("help-articles.json");
  const gaps = load<KnownGap>("known-gaps.json");
  const pages: BrainPage[] = [
    ...articles.map((article) => helpPage(article, PRODUCT)),
    ...gaps.map((gap) => gapPage(gap, PRODUCT)),
  ];

  let failed = 0;
  for (const page of pages) {
    const started = Date.now();
    try {
      const result = await callTool(workspace, "put_page", { slug: page.slug, content: page.content }, 60_000);
      const said = typeof result === "string" ? result : JSON.stringify(result);
      console.log(`wrote  ${page.slug}  (${page.content.length} characters, ${Date.now() - started} ms)  ${said.slice(0, 200)}`);
    } catch (error) {
      failed += 1;
      console.log(`FAILED ${page.slug}  ${(error as Error).message}`);
    }
  }

  console.log(
    `${articles.length} help articles and ${gaps.length} known gaps: ${pages.length - failed} pages written, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
