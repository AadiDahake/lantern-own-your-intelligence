#!/usr/bin/env -S npx tsx
/**
 * One search of the company brain, through the same `searchBrain` the documentation check calls.
 *
 *   npx tsx integrations/gbrain/search.ts "Where do I add a checked bag?" [prefix]
 *
 * The optional prefix keeps one kind of page: `help/` or `gaps/`.
 */
import { searchBrain } from "../../apps/web/lib/brain/provider";

async function main(): Promise<void> {
  const query = process.argv[2] ?? "Where do I add a checked bag?";
  const prefix = process.argv[3];
  const found = await searchBrain(query, { limit: 5, snippetChars: 300, timeoutMs: 15_000, ...(prefix ? { prefix } : {}) });
  if (!found.configured) {
    console.error(`The brain is ${found.reason}. Set GBRAIN_MCP_URL and GBRAIN_TOKEN.`);
    process.exitCode = 1;
    return;
  }
  console.log(`"${query}"${prefix ? ` in ${prefix}` : ""}: ${found.hits.length} hits in ${found.latencyMs} ms`);
  found.hits.forEach((hit, index) => {
    const cosine = hit.cosine === null ? "none" : hit.cosine.toFixed(3);
    console.log(
      `${index + 1}. ${hit.source.slug}  "${hit.title}"  type ${hit.type || "none"}  score ${hit.score.toFixed(3)}  cosine ${cosine}  evidence ${hit.evidence ?? "none"}  source ${hit.source.sourceId}`,
    );
    console.log(`   ${hit.snippet.replace(/\s+/g, " ").slice(0, 160)}`);
  });
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
