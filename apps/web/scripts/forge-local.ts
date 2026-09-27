/**
 * Runs the forge engine from the terminal, with no database and no console: the trace prints
 * here, the candidate rows live in memory, and the strategy is whatever the environment selects
 * (the local one when no key is set).
 *
 *   npm run forge:local -- --spec apps/web/lib/forge/fixtures/seat-party-together.ir.json
 *
 * Options:
 *   --spec <path>        the Capability IR to build (required)
 *   --repo <owner/name>  the target repository (default: FORGE_TARGET_REPO, else AadiDahake/novaair-own-your-intelligence)
 *   --source <path|url>  clone from here instead of GitHub; pushes still go to GitHub (local strategy)
 *   --base <branch>      the base branch (default: main)
 *   --strategy <name>    reflex | runloop | local (default: from the environment)
 *   --no-push            stop before the push and print what would be pushed
 *   --hold <seconds>     keep the winner's preview up this long before tearing it down (default: 0)
 *   --keep               do not tear the winner down at the end
 *   --trace-out <path>   also write every trace row to this file, one JSON object per line
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { buildForgeDeps } from "../lib/forge/config";
import { runForge, type ForgeRunResult } from "../lib/forge/engine";
import { parseCapabilityIr } from "../lib/forge/ir";
import { MemoryForgeStore } from "../lib/forge/store";
import type { TargetRepo } from "../lib/forge/strategy";
import { forgeTargetRepo, type ForgeStrategyName } from "../lib/env";

type Args = {
  spec: string;
  repo: string;
  source: string | null;
  base: string;
  strategy: ForgeStrategyName | null;
  push: boolean;
  hold: number;
  keep: boolean;
  traceOut: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    spec: "",
    repo: forgeTargetRepo(),
    source: null,
    base: "main",
    strategy: null,
    push: true,
    hold: 0,
    keep: false,
    traceOut: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--spec":
        args.spec = value ?? "";
        index += 1;
        break;
      case "--repo":
        args.repo = value ?? args.repo;
        index += 1;
        break;
      case "--source":
        args.source = value ?? null;
        index += 1;
        break;
      case "--base":
        args.base = value ?? args.base;
        index += 1;
        break;
      case "--strategy":
        if (value === "reflex" || value === "runloop" || value === "local") args.strategy = value;
        index += 1;
        break;
      case "--no-push":
        args.push = false;
        break;
      case "--hold":
        args.hold = Number(value ?? 0);
        index += 1;
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--trace-out":
        args.traceOut = value ?? null;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  if (!args.spec) throw new Error("--spec <path> is required");
  return args;
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const ACCENT = "\x1b[38;5;202m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ir = parseCapabilityIr(JSON.parse(readFileSync(args.spec, "utf8")));
  const [owner, name] = args.repo.split("/");
  if (!owner || !name) throw new Error(`--repo must be owner/name, got ${args.repo}`);
  const repo: TargetRepo = {
    fullName: args.repo,
    owner,
    name,
    defaultBranch: args.base,
    token: process.env.GITHUB_TOKEN || null,
    source: args.source,
  };
  if (args.traceOut) writeFileSync(args.traceOut, "");

  const store = new MemoryForgeStore((event) => {
    const colour = event.status === "failed" ? RED : event.status === "running" ? DIM : event.kind === "decision" || event.kind === "preview" ? GREEN : "";
    console.log(`${DIM}${stamp()}${RESET} ${DIM}${event.source}/${event.kind}${RESET} ${colour}${event.title}${RESET}`);
    if (args.traceOut) appendFileSync(args.traceOut, `${JSON.stringify(event)}\n`);
  });
  const log = (line: string): void => console.log(`${DIM}${stamp()} ${line}${RESET}`);
  const deps = buildForgeDeps(store, { name: args.strategy ?? undefined, log });

  console.log(`${ACCENT}lantern${RESET} forge: ${ir.intent} on ${repo.fullName}@${repo.defaultBranch} (${deps.strategy.name})`);
  const escalationId = `local-${Date.now().toString(36)}`;
  let result: ForgeRunResult | null = null;
  try {
    result = await runForge(
      { escalationId, ir, capabilitySpecId: null, repo, opportunityUrl: null, push: args.push },
      deps,
    );
    printSummary(result, store);
    if (result.previewUrl && args.hold > 0) {
      console.log(`\nPreview is live at ${result.previewUrl} for ${args.hold} s.`);
      await new Promise((resolve) => setTimeout(resolve, args.hold * 1000));
    }
  } finally {
    if (result?.winner?.sandbox && !args.keep) {
      await result.winner.sandbox.teardown().catch((error: Error) => log(`teardown failed: ${error.message}`));
      console.log(`Candidate ${result.winner.label} torn down.`);
    } else if (result?.winner?.sandbox) {
      console.log(`Candidate ${result.winner.label} kept at ${JSON.stringify(result.winner.sandbox.handle)}.`);
    }
  }
  if (result?.status === "failed") process.exit(1);
}

function printSummary(result: ForgeRunResult, store: MemoryForgeStore): void {
  console.log("");
  for (const candidate of store.candidates.values()) {
    const score =
      candidate.scenariosPassed === null ? "did not finish" : `${candidate.scenariosPassed}/${candidate.scenariosTotal} scenarios`;
    const failing = candidate.failingScenarios?.length ? ` (failing: ${candidate.failingScenarios.join(", ")})` : "";
    console.log(`Candidate ${candidate.label}: ${candidate.status}, ${score}${failing}${candidate.error ? `, ${candidate.error}` : ""}`);
  }
  if (result.winner) console.log(`Winner: candidate ${result.winner.label} on ${result.winner.branch}`);
  if (result.previewUrl) console.log(`Preview: ${result.previewUrl}`);
  if (result.pr) console.log(`Draft PR: ${result.pr.url}`);
  if (result.wouldPush) {
    console.log(`\nStopped before the push. Would push ${result.wouldPush.branch} and open "${result.wouldPush.title}" with ${result.wouldPush.files.length} changed files:`);
    for (const file of result.wouldPush.files) console.log(`  ${file}`);
    console.log("\n--- pull request body ---\n");
    console.log(result.wouldPush.body);
    console.log("\n--- end ---");
  }
  if (result.error) console.log(`${RED}Failed: ${result.error}${RESET}`);
}

main().catch((error: Error) => {
  console.error(`${RED}${error.message}${RESET}`);
  process.exit(1);
});
