#!/usr/bin/env -S npx tsx
/**
 * The live check of the agent search, through the same client and the same gate the product uses.
 *
 *   LANTERN_DARWIN=public npm run darwin:live                             # public search, no key
 *   LANTERN_DARWIN=public npm run darwin:live -- "exporting a report as CSV"
 *   npm run darwin:live -- "finding seats together"                       # with DARWIN_API_KEY set
 *
 * With neither variable it calls nothing and says that the search is off (exit 0). A search that
 * fails is exit 1. It prints each listing the index returned, what the gate says about it, and
 * the trace row that a turn would write. It never prints the key. Run it through your secret
 * manager when you use a key.
 */
import { gate, queryFor, sameName } from "../apps/web/lib/alternatives/gate";
import { outsideTrace } from "../apps/web/lib/alternatives/search";
import { searchAgents } from "../apps/web/lib/darwin";
import { agentSearch } from "../apps/web/lib/env";

const DEFAULT_CAPABILITY = "finding seats together";

async function main(): Promise<number> {
  const capability = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? DEFAULT_CAPABILITY;

  const configured = agentSearch();
  if (!configured.configured) {
    console.log(`Outside services: off (${configured.reason}). Nothing was called.`);
    console.log("Set LANTERN_DARWIN=public to search with no key.");
    return 0;
  }
  const query = queryFor(capability);
  if (!query) {
    console.error(`"${capability}" is not searched: a capability name leaves the product only as two to eight plain words.`);
    return 2;
  }

  const { config } = configured;
  console.log(`Searching ${config.apiUrl} ${config.apiKey ? "with the key" : "with no key (public)"} for: ${query}`);
  const found = await searchAgents(config, query);
  if (!found.ok) {
    console.error(`No usable answer after ${found.latencyMs} ms: ${found.reason}.`);
    return 1;
  }

  console.log(`${found.listings.length} listing(s) in ${found.latencyMs} ms:`);
  for (const listing of found.listings) {
    const marks = [
      sameName(query, listing.name) ? "named for the capability" : "a different name",
      listing.startable ? "can start now" : `cannot start now (${listing.readiness})`,
      listing.paid ? "needs a payment" : "no payment named",
      listing.verified ? "verified" : "not verified",
    ];
    console.log(`  ${listing.rank}. "${listing.name}" by ${listing.provider || "an unnamed service"}: ${marks.join(", ")}`);
  }

  const result = gate(found.listings, query);
  const row = outsideTrace({ state: "done", query, latencyMs: found.latencyMs, ...result });
  console.log(`Trace row: ${row.title}`);
  console.log(`  ${String(row.detail.result_summary)}`);
  if (result.offered.length === 0) {
    console.log("A visitor is offered nothing for this capability.");
    return 0;
  }
  console.log("A visitor is offered:");
  for (const offer of result.offered) {
    console.log(`  "${offer.name}" by ${offer.provider}`);
    console.log(`    ${offer.url}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.name : "The check failed.");
    process.exit(1);
  },
);
