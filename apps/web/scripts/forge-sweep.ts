/**
 * Shuts down every Runloop devbox the forge engine tagged and left running.
 *
 *   npm run forge:sweep
 *
 * A crash, a killed process or a lost network connection can leave a candidate's box alive. Each
 * box carries `metadata.lantern_candidate`, so this lists what is alive by that tag and shuts it
 * down. Nothing else in the account is touched.
 */
import { codexApiKey, runloopApiKey } from "../lib/env";
import { RunloopStrategy } from "../lib/forge/runloop";

async function main(): Promise<void> {
  const strategy = new RunloopStrategy({
    apiKey: runloopApiKey(),
    openaiApiKey: codexApiKey() ?? "",
    log: (line) => console.log(line),
  });
  const swept = await strategy.sweep();
  if (swept.length === 0) {
    console.log("No forge devboxes are running.");
    return;
  }
  for (const box of swept) {
    console.log(`Shut down ${box.id} (${box.name ?? "unnamed"}, candidate ${box.candidate}, was ${box.status}).`);
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
