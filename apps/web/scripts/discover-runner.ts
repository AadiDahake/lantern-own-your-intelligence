/**
 * The discovery runner: claims queued runs of the opportunity pipeline and executes them.
 *
 *   npm run discover:runner                    poll forever
 *   npm run discover:runner -- --once          drain the queue, then exit
 *   npm run discover:runner -- --model codex   compile through the machine's own `codex exec`
 *
 * A host that caps a request's duration (Vercel, 300 s) sets `DISCOVERY_MODE=runner` so the
 * routes only enqueue, and this process does the mining and the compiling. Claiming goes through
 * `claim_discovery`, so several runners can share one queue.
 *
 * `--model codex` is the development loop the compiler CLI documents: the same prompts through
 * the Codex CLI's saved sign-in, with no API key. The server path stays on the OpenAI client.
 */
import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelClient } from "@lantern/capability";
import { CodexModelClient } from "../../../scripts/lib/codex-model";
import { claimNextDiscovery } from "../lib/opportunity/queue";
import { executeDiscovery } from "../lib/opportunity/run";

const POLL_MS = 2_000;
const args = process.argv.slice(2);
const once = args.includes("--once");
const worker = `${hostname()}:${process.pid}`;

function modelOverride(): ModelClient | undefined {
  const index = args.indexOf("--model");
  const name = index >= 0 ? args[index + 1] : undefined;
  if (name === undefined || name === "openai") return undefined;
  if (name !== "codex") throw new Error(`--model takes openai or codex, not "${name}"`);
  const workdir = mkdtempSync(join(tmpdir(), "lantern-discover-codex-"));
  return new CodexModelClient({
    workdir,
    onCall: (call) => log(`codex ${call.purpose}: ${call.duration_ms} ms, exit ${call.exit}`),
  });
}

const model = modelOverride();

const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

async function drain(): Promise<number> {
  let ran = 0;
  for (;;) {
    const claimed = await claimNextDiscovery(worker);
    if (!claimed) return ran;
    ran += 1;
    await executeDiscovery(claimed.id, {
      alreadyClaimed: true,
      model,
      log: (line) => log(`[discovery ${claimed.id.slice(0, 8)}] ${line}`),
    });
  }
}

async function main(): Promise<void> {
  log(`discovery runner ${worker} started${once ? " (once)" : ""}${model ? ` with ${model.name}` : ""}`);
  for (;;) {
    try {
      const ran = await drain();
      if (once) {
        log(`drained ${ran} run(s)`);
        return;
      }
    } catch (error) {
      log(`runner error: ${(error as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void main();
